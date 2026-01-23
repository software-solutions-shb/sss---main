/**
 * ============================================
 * DATABASE CLIENT
 * Software Solutions Services
 * ============================================
 * 
 * Client module for communicating with the local SQLite database
 * API server via HTTP.
 * 
 * This module is used by Netlify serverless functions to store
 * and retrieve submission data.
 * 
 * ============================================
 * CONFIGURATION:
 * ============================================
 * 
 * Set the following environment variables in Netlify:
 *   SSS_DB_API_URL - The URL of your local database server (required)
 *                    Example: https://your-tunnel.ngrok.io
 *   SSS_DB_SECRET  - Shared secret for API authentication (required)
 *                    Must be at least 32 characters
 * 
 * IMPORTANT: For Netlify functions to reach your local server,
 * you'll need to expose it via a tunnel service like:
 * - ngrok: ngrok http 3456
 * - cloudflared: cloudflared tunnel --url http://localhost:3456
 * 
 * Then set SSS_DB_API_URL to the tunnel URL.
 * 
 * @module netlify/functions/utils/database-client
 */

const https = require('https');
const http = require('http');

// ============================================
// CONFIGURATION
// ============================================

/**
 * Get the database API URL from environment
 * REQUIRED: Must be set in Netlify environment variables
 * @throws {Error} If SSS_DB_API_URL is not configured
 */
function getApiUrl() {
  const url = process.env.SSS_DB_API_URL;
  if (!url) {
    throw new Error(
      'FATAL: SSS_DB_API_URL environment variable is REQUIRED. ' +
      'Set this to your ngrok/tunnel URL (e.g., https://abc123.ngrok.io)'
    );
  }
  return url;
}

/**
 * Get the shared secret from environment
 * REQUIRED: Must match SSS_DB_SECRET on the local server
 * @throws {Error} If SSS_DB_SECRET is not configured
 */
function getSharedSecret() {
  const secret = process.env.SSS_DB_SECRET;
  if (!secret) {
    throw new Error(
      'FATAL: SSS_DB_SECRET environment variable is REQUIRED. ' +
      'This must match the secret configured on your local database server.'
    );
  }
  if (secret.length < 32) {
    throw new Error(
      'FATAL: SSS_DB_SECRET is too short (minimum 32 characters). ' +
      'Use a cryptographically secure random value.'
    );
  }
  return secret;
}

/**
 * Determine if URL is HTTPS or HTTP
 */
function getHttpModule(url) {
  return url.startsWith('https://') ? https : http;
}

// ============================================
// RETRY CONFIGURATION
// ============================================

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;
const BACKOFF_MULTIPLIER = 2; // Exponential backoff

// ============================================
// IN-MEMORY RETRY QUEUE
// For queuing requests when API is offline
// ============================================
const retryQueue = [];
let isProcessingQueue = false;

/**
 * Sleep helper for retry delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// HTTP REQUEST HELPER
// ============================================

/**
 * Make an HTTP request to the database API
 * 
 * @param {string} method - HTTP method (GET, POST)
 * @param {string} path - API path (e.g., /api/submissions)
 * @param {Object|null} data - Request body for POST requests
 * @returns {Promise<Object>} Parsed JSON response
 */
async function makeRequest(method, path, data = null) {
  // Get required configuration - these will throw if not set
  const baseUrl = getApiUrl();
  const sharedSecret = getSharedSecret(); // REQUIRED - throws if missing
  
  const fullUrl = new URL(path, baseUrl);
  const httpModule = getHttpModule(baseUrl);
  
  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      // SECURITY: Always attach the shared secret header
      // This authenticates every request to the database API
      'X-SSS-Secret': sharedSecret
    };
    
    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 80),
      path: fullUrl.pathname,
      method: method,
      headers: headers,
      timeout: 30000 // 30 second timeout
    };
    
    const req = httpModule.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const error = new Error(parsed.error || `HTTP ${res.statusCode}`);
            error.statusCode = res.statusCode;
            error.response = parsed;
            reject(error);
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, statusCode: res.statusCode });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          }
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Database API connection error: ${error.message}`));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Database API request timeout'));
    });
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

/**
 * Make request with retry logic
 */
async function makeRequestWithRetry(method, path, data = null) {
  let lastError;
  let delay = RETRY_DELAY_MS;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await makeRequest(method, path, data);
    } catch (error) {
      lastError = error;
      
      // Don't retry on 4xx errors (client errors) - these won't change with retry
      if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        throw error;
      }
      
      if (attempt < MAX_RETRIES) {
        console.log(`[DB Client] Request failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms...`);
        await sleep(delay);
        delay *= BACKOFF_MULTIPLIER; // Exponential backoff
      }
    }
  }
  
  throw lastError;
}

/**
 * Queue a submission for later retry when API is offline
 * This ensures data is not lost even if the local server is temporarily unavailable
 * 
 * NOTE: This queue is in-memory and will be lost if the Netlify function container restarts.
 * For critical data, consider logging to a fallback location or returning the payload
 * in the response for manual recovery.
 * 
 * @param {Object} data - The submission data to queue
 * @returns {Object} Queue status
 */
function queueForRetry(data) {
  const queueEntry = {
    id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    data: data,
    timestamp: new Date().toISOString(),
    attempts: 0,
    maxAttempts: 5
  };
  
  retryQueue.push(queueEntry);
  console.log(`[DB Client] Queued submission for retry: ${queueEntry.id} (queue size: ${retryQueue.length})`);
  
  // Try to process queue in background (fire and forget)
  processRetryQueue().catch(err => {
    console.log('[DB Client] Background queue processing deferred:', err.message);
  });
  
  return {
    queued: true,
    queueId: queueEntry.id,
    queueSize: retryQueue.length
  };
}

/**
 * Process the retry queue with exponential backoff
 */
async function processRetryQueue() {
  if (isProcessingQueue || retryQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  console.log(`[DB Client] Processing retry queue (${retryQueue.length} items)...`);
  
  const successfulIds = [];
  
  for (const entry of retryQueue) {
    if (entry.attempts >= entry.maxAttempts) {
      console.log(`[DB Client] Abandoning ${entry.id} after ${entry.attempts} attempts`);
      successfulIds.push(entry.id); // Remove from queue
      continue;
    }
    
    entry.attempts++;
    
    try {
      await makeRequest('POST', '/api/submissions', entry.data);
      console.log(`[DB Client] Retry successful for ${entry.id}`);
      successfulIds.push(entry.id);
    } catch (error) {
      console.log(`[DB Client] Retry failed for ${entry.id}: ${error.message}`);
      // Leave in queue for next attempt
    }
  }
  
  // Remove successful entries
  for (const id of successfulIds) {
    const index = retryQueue.findIndex(e => e.id === id);
    if (index > -1) {
      retryQueue.splice(index, 1);
    }
  }
  
  isProcessingQueue = false;
  console.log(`[DB Client] Queue processing complete (${retryQueue.length} remaining)`);
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Append/upsert subscriber data to the database
 * 
 * This function provides idempotency using submission_id.
 * If a record with the same submission_id exists, it will be updated.
 * Otherwise, a new record will be created.
 * 
 * If the API is temporarily offline, the data is queued for retry.
 * 
 * @param {Object} subscriberData - The subscriber data to append
 * @param {Object} options - Options: { queueOnFailure: boolean }
 * @returns {Promise<Object>} Database API response
 */
async function appendToDatabase(subscriberData, options = { queueOnFailure: true }) {
  // Validate required field
  const submissionId = subscriberData.submissionId || subscriberData.submission_id;
  
  if (!submissionId) {
    console.warn('[DB Client] No submission_id provided, generating temporary ID');
    subscriberData.submission_id = `TEMP-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  }
  
  // Log safely (no secrets or PII)
  console.log('[DB Client] Appending to database:', {
    submission_id: subscriberData.submissionId || subscriberData.submission_id,
    has_email: !!subscriberData.email,
    has_payment: !!subscriberData.paymentStatus,
    business_name: subscriberData.businessName || subscriberData.business_name || 'N/A'
  });
  
  try {
    const result = await makeRequestWithRetry('POST', '/api/submissions', subscriberData);
    console.log('[DB Client] Database write successful:', result.action || 'ok');
    return result;
  } catch (error) {
    console.error('[DB Client] Database write failed:', error.message);
    
    // Queue for retry if enabled and it's a connection error (not auth error)
    if (options.queueOnFailure && (!error.statusCode || error.statusCode >= 500)) {
      console.log('[DB Client] Queueing submission for later retry...');
      return queueForRetry(subscriberData);
    }
    
    throw error;
  }
}

/**
 * Find a record by Submission ID
 * 
 * @param {string} submissionId - The submission ID to search for
 * @returns {Promise<Object|null>} The found record or null
 */
async function findBySubmissionId(submissionId) {
  if (!submissionId) {
    return null;
  }
  
  console.log('[DB Client] Finding submission:', submissionId);
  
  try {
    const encodedId = encodeURIComponent(submissionId);
    const result = await makeRequestWithRetry('GET', `/api/submissions/${encodedId}`);
    
    if (result.success && result.data) {
      console.log('[DB Client] Found submission');
      return result.data;
    }
    
    return null;
  } catch (error) {
    if (error.statusCode === 404) {
      console.log('[DB Client] Submission not found');
      return null;
    }
    console.error('[DB Client] Find failed:', error.message);
    throw error;
  }
}

/**
 * Update a record by submission ID
 * 
 * Note: This is implemented via upsert, so it will create the record
 * if it doesn't exist.
 * 
 * @param {string} submissionId - The submission ID
 * @param {Object} fields - The fields to update
 * @returns {Promise<Object>} Updated record
 */
async function updateRecord(submissionId, fields) {
  if (!submissionId) {
    throw new Error('submissionId is required');
  }
  
  // Include submission_id in the update data
  const updateData = {
    submission_id: submissionId,
    ...fields
  };
  
  console.log('[DB Client] Updating record:', submissionId);
  
  try {
    const result = await makeRequestWithRetry('POST', '/api/submissions', updateData);
    console.log('[DB Client] Update successful');
    return result;
  } catch (error) {
    console.error('[DB Client] Update failed:', error.message);
    throw error;
  }
}

/**
 * Check if the database server is reachable (PUBLIC - no auth required)
 * This calls the /health endpoint which is intentionally public
 * 
 * @returns {Promise<Object>} Health status with details
 */
async function healthCheck() {
  try {
    // Health check uses a simplified request without auth requirement
    // because /health is a public endpoint on the server
    const baseUrl = getApiUrl();
    const fullUrl = new URL('/health', baseUrl);
    const httpModule = getHttpModule(baseUrl);
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: fullUrl.hostname,
        port: fullUrl.port || (fullUrl.protocol === 'https:' ? 443 : 80),
        path: fullUrl.pathname,
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 10000
      };
      
      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve({
              healthy: result.status === 'ok',
              timestamp: result.timestamp,
              database: result.database,
              queue_length: result.queue_length,
              auth_configured: result.auth_configured,
              local_queue_length: retryQueue.length
            });
          } catch (e) {
            reject(new Error('Invalid health response'));
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Health check timeout'));
      });
      req.end();
    });
  } catch (error) {
    console.error('[DB Client] Health check failed:', error.message);
    return {
      healthy: false,
      error: error.message,
      local_queue_length: retryQueue.length
    };
  }
}

/**
 * Get current retry queue status
 * @returns {Object} Queue status
 */
function getQueueStatus() {
  return {
    length: retryQueue.length,
    isProcessing: isProcessingQueue,
    entries: retryQueue.map(e => ({
      id: e.id,
      submission_id: e.data?.submission_id || e.data?.submissionId,
      attempts: e.attempts,
      timestamp: e.timestamp
    }))
  };
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  appendToDatabase,
  findBySubmissionId,
  updateRecord,
  healthCheck,
  getQueueStatus,
  processRetryQueue
};
