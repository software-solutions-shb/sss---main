/**
 * Remote Logger Utility
 * 
 * Sends log entries to the local database server via ngrok tunnel
 * for real-time monitoring and debugging.
 * 
 * @module netlify/functions/utils/remote-logger
 */

const https = require('https');
const http = require('http');

/**
 * Send a log entry to the remote logging server
 * 
 * @param {string} level - Log level: INFO, SUCCESS, WARNING, ERROR, DEBUG
 * @param {string} source - Source identifier (e.g., 'ITN', 'REDIRECT', 'EMAIL')
 * @param {string} message - Log message
 * @param {Object} data - Additional data to log (optional)
 * @returns {Promise<boolean>} True if logged successfully
 */
async function remoteLog(level, source, message, data = null) {
  const apiUrl = process.env.SSS_DB_API_URL;
  const secret = process.env.SSS_DB_SECRET;
  
  // Skip if not configured
  if (!apiUrl || !secret) {
    console.log(`[${level}] [${source}] ${message}`, data || '');
    return false;
  }
  
  try {
    const url = new URL('/api/logs', apiUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const payload = JSON.stringify({
      level,
      source,
      message,
      data
    });
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-SSS-Secret': secret
      },
      timeout: 5000
    };
    
    return new Promise((resolve) => {
      const req = client.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve(res.statusCode === 200);
        });
      });
      
      req.on('error', () => {
        // Silently fail - don't break the main flow for logging
        resolve(false);
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      
      req.write(payload);
      req.end();
    });
  } catch (err) {
    // Silently fail
    return false;
  }
}

/**
 * Log info level message
 */
function logInfo(source, message, data = null) {
  console.log(`[INFO] [${source}] ${message}`, data ? JSON.stringify(data) : '');
  return remoteLog('INFO', source, message, data);
}

/**
 * Log success level message
 */
function logSuccess(source, message, data = null) {
  console.log(`[SUCCESS] [${source}] ${message}`, data ? JSON.stringify(data) : '');
  return remoteLog('SUCCESS', source, message, data);
}

/**
 * Log warning level message
 */
function logWarning(source, message, data = null) {
  console.log(`[WARNING] [${source}] ${message}`, data ? JSON.stringify(data) : '');
  return remoteLog('WARNING', source, message, data);
}

/**
 * Log error level message
 */
function logError(source, message, data = null) {
  console.error(`[ERROR] [${source}] ${message}`, data ? JSON.stringify(data) : '');
  return remoteLog('ERROR', source, message, data);
}

/**
 * Log debug level message
 */
function logDebug(source, message, data = null) {
  console.log(`[DEBUG] [${source}] ${message}`, data ? JSON.stringify(data) : '');
  return remoteLog('DEBUG', source, message, data);
}

module.exports = {
  remoteLog,
  logInfo,
  logSuccess,
  logWarning,
  logError,
  logDebug
};
