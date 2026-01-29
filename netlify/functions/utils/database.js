/**
 * ============================================
 * DATABASE MODULE - Neon PostgreSQL
 * Software Solutions Services
 * ============================================
 * 
 * Clean PostgreSQL database module using Netlify DB (Neon).
 * 
 * CRITICAL DESIGN PRINCIPLE:
 * - The `submissions` table ONLY contains PAID customers
 * - Form data is stored temporarily in `pending_form_data` until payment succeeds
 * - On successful payment (ITN COMPLETE), data moves from pending to submissions
 * - No unpaid submissions are ever persisted in the main table
 * 
 * ENVIRONMENT VARIABLES REQUIRED:
 *   DATABASE_URL - Provided automatically by Netlify DB integration
 * 
 * @module netlify/functions/utils/database
 */

const { Pool } = require('pg');

// ============================================
// DATABASE CONNECTION
// ============================================

let pool = null;

/**
 * Get or create the database connection pool
 * Uses SSL for secure connection to Neon
 * 
 * @returns {Pool} PostgreSQL connection pool
 */
function getPool() {
  if (!pool) {
    // Netlify Neon integration uses NETLIFY_DATABASE_URL
    // Fall back to DATABASE_URL for local development
    const connectionString = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
    
    if (!connectionString) {
      throw new Error(
        'NETLIFY_DATABASE_URL or DATABASE_URL environment variable is required. ' +
        'Enable Netlify DB integration in your Netlify site settings.'
      );
    }
    
    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: true // Enforce SSL verification
      },
      max: 5, // Max connections in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    
    // Handle pool errors gracefully
    pool.on('error', (err) => {
      console.error('[Database] Unexpected pool error:', err.message);
    });
  }
  
  return pool;
}

// ============================================
// SCHEMA INITIALIZATION
// ============================================

/**
 * Initialize the database schema
 * Creates both pending_form_data and submissions tables
 * 
 * @returns {Promise<void>}
 */
async function initializeSchema() {
  const client = await getPool().connect();
  
  try {
    // ----------------------------------------
    // PENDING FORM DATA TABLE
    // Temporary storage before payment confirmation
    // This table is for the payment flow handoff only
    // ----------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_form_data (
        id SERIAL PRIMARY KEY,
        submission_id VARCHAR(50) UNIQUE NOT NULL,
        
        -- Complete form data as JSONB (the ENTIRE form submission)
        form_data JSONB NOT NULL,
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        -- Auto-expire after 2 hours (cleanup handled separately)
        expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '2 hours')
      );
      
      -- Index for fast lookups
      CREATE INDEX IF NOT EXISTS idx_pending_submission_id 
        ON pending_form_data(submission_id);
      
      -- Index for cleanup queries
      CREATE INDEX IF NOT EXISTS idx_pending_expires_at 
        ON pending_form_data(expires_at);
    `);
    
    // ----------------------------------------
    // SUBMISSIONS TABLE
    // ONLY contains PAID customers (payment_status = 'COMPLETE')
    // ----------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id SERIAL PRIMARY KEY,
        submission_id VARCHAR(50) UNIQUE NOT NULL,
        
        -- Core business fields (extracted for easy querying)
        business_name VARCHAR(255),
        owner_first_name VARCHAR(100),
        owner_last_name VARCHAR(100),
        email VARCHAR(255),
        phone VARCHAR(50),
        industry VARCHAR(255),
        
        -- Payment fields (all successful payments)
        payment_status VARCHAR(50) NOT NULL DEFAULT 'COMPLETE',
        payfast_payment_id VARCHAR(100),
        subscription_token VARCHAR(255),
        amount_gross DECIMAL(10, 2),
        amount_net DECIMAL(10, 2),
        
        -- COMPLETE form data as JSONB (the ENTIRE original form submission)
        -- This is the CRITICAL field - contains every field client submitted
        form_data JSONB NOT NULL DEFAULT '{}',
        
        -- Payment metadata from ITN
        payment_data JSONB DEFAULT '{}',
        
        -- Timestamps
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      -- Index for fast lookups by submission_id
      CREATE INDEX IF NOT EXISTS idx_submissions_submission_id 
        ON submissions(submission_id);
      
      -- Index for email lookups
      CREATE INDEX IF NOT EXISTS idx_submissions_email 
        ON submissions(email);
    `);
    
    console.log('[Database] Schema initialized successfully');
  } finally {
    client.release();
  }
}

// ============================================
// PENDING FORM DATA OPERATIONS
// (Before payment is confirmed)
// ============================================

/**
 * Store form data temporarily before payment
 * Called from payfast-redirect when user starts payment flow
 * 
 * @param {string} submissionId - Unique submission ID
 * @param {Object} formData - Complete form data object (ALL fields)
 * @returns {Promise<Object>} The stored pending record
 */
async function storePendingFormData(submissionId, formData) {
  if (!submissionId) {
    throw new Error('submissionId is required');
  }
  
  if (!formData || typeof formData !== 'object') {
    throw new Error('formData must be a valid object');
  }
  
  const client = await getPool().connect();
  
  try {
    // Upsert to handle retries/refreshes
    const result = await client.query(`
      INSERT INTO pending_form_data (submission_id, form_data)
      VALUES ($1, $2)
      ON CONFLICT (submission_id) DO UPDATE SET
        form_data = EXCLUDED.form_data,
        created_at = NOW(),
        expires_at = NOW() + INTERVAL '2 hours'
      RETURNING *
    `, [submissionId, JSON.stringify(formData)]);
    
    console.log('[Database] Pending form data stored:', submissionId);
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Retrieve pending form data by submission ID
 * 
 * @param {string} submissionId - The submission ID to find
 * @param {boolean} ignoreExpiry - If true, return even expired records (for recovery)
 * @returns {Promise<Object|null>} The form data or null if not found
 */
async function getPendingFormData(submissionId, ignoreExpiry = false) {
  if (!submissionId) {
    return null;
  }
  
  const client = await getPool().connect();
  
  try {
    // Build query - optionally ignore expiry for data recovery
    const query = ignoreExpiry 
      ? `SELECT * FROM pending_form_data WHERE submission_id = $1`
      : `SELECT * FROM pending_form_data WHERE submission_id = $1 AND expires_at > NOW()`;
    
    const result = await client.query(query, [submissionId]);
    
    if (result.rows.length === 0) {
      console.log('[Database] Pending form data not found:', submissionId, ignoreExpiry ? '(ignoring expiry)' : '');
      return null;
    }
    
    console.log('[Database] Pending form data retrieved:', submissionId);
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Delete pending form data (after successful payment or cleanup)
 * 
 * @param {string} submissionId - The submission ID to delete
 * @returns {Promise<boolean>} True if deleted
 */
async function deletePendingFormData(submissionId) {
  if (!submissionId) {
    return false;
  }
  
  const client = await getPool().connect();
  
  try {
    const result = await client.query(`
      DELETE FROM pending_form_data WHERE submission_id = $1
    `, [submissionId]);
    
    const deleted = result.rowCount > 0;
    if (deleted) {
      console.log('[Database] Pending form data deleted:', submissionId);
    }
    return deleted;
  } finally {
    client.release();
  }
}

/**
 * Clean up expired pending form data
 * Should be called periodically (e.g., by a scheduled function)
 * 
 * @returns {Promise<number>} Number of records deleted
 */
async function cleanupExpiredPendingData() {
  const client = await getPool().connect();
  
  try {
    const result = await client.query(`
      DELETE FROM pending_form_data WHERE expires_at < NOW()
    `);
    
    console.log('[Database] Expired pending data cleaned up:', result.rowCount, 'records');
    return result.rowCount;
  } finally {
    client.release();
  }
}

// ============================================
// PAID SUBMISSIONS OPERATIONS
// (Only called after payment is COMPLETE)
// ============================================

/**
 * Create a paid submission record
 * 
 * CRITICAL: This should ONLY be called when payment_status === 'COMPLETE'
 * This is the ONLY way data enters the submissions table
 * 
 * Uses upsert for idempotency (PayFast may retry ITN)
 * 
 * @param {Object} params - Submission parameters
 * @param {string} params.submissionId - Unique submission ID (required)
 * @param {Object} params.formData - Complete original form data (required)
 * @param {Object} params.paymentData - Payment data from ITN
 * @returns {Promise<Object>} The created/updated submission
 */
async function createPaidSubmission({ submissionId, formData, paymentData }) {
  if (!submissionId) {
    throw new Error('submissionId is required');
  }
  
  if (!formData || typeof formData !== 'object') {
    throw new Error('formData is required and must be an object');
  }
  
  // Extract commonly-queried fields for dedicated columns
  const coreFields = {
    submission_id: submissionId,
    business_name: formData.businessName || null,
    owner_first_name: formData.ownerFirstName || null,
    owner_last_name: formData.ownerLastName || null,
    email: formData.businessEmail || null,
    phone: formData.businessPhone || null,
    industry: formData.industry || null,
    payment_status: 'COMPLETE',
    payfast_payment_id: paymentData?.pf_payment_id || paymentData?.pfPaymentId || null,
    subscription_token: paymentData?.token || null,
    amount_gross: paymentData?.amount_gross ? parseFloat(paymentData.amount_gross) : null,
    amount_net: paymentData?.amount_net ? parseFloat(paymentData.amount_net) : null
  };
  
  const client = await getPool().connect();
  
  try {
    // Upsert for idempotency (duplicate ITN handling)
    const result = await client.query(`
      INSERT INTO submissions (
        submission_id,
        business_name,
        owner_first_name,
        owner_last_name,
        email,
        phone,
        industry,
        payment_status,
        payfast_payment_id,
        subscription_token,
        amount_gross,
        amount_net,
        form_data,
        payment_data,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      ON CONFLICT (submission_id) DO UPDATE SET
        payment_status = 'COMPLETE',
        payfast_payment_id = COALESCE(EXCLUDED.payfast_payment_id, submissions.payfast_payment_id),
        subscription_token = COALESCE(EXCLUDED.subscription_token, submissions.subscription_token),
        amount_gross = COALESCE(EXCLUDED.amount_gross, submissions.amount_gross),
        amount_net = COALESCE(EXCLUDED.amount_net, submissions.amount_net),
        payment_data = COALESCE(EXCLUDED.payment_data, submissions.payment_data),
        updated_at = NOW()
      RETURNING *
    `, [
      coreFields.submission_id,
      coreFields.business_name,
      coreFields.owner_first_name,
      coreFields.owner_last_name,
      coreFields.email,
      coreFields.phone,
      coreFields.industry,
      coreFields.payment_status,
      coreFields.payfast_payment_id,
      coreFields.subscription_token,
      coreFields.amount_gross,
      coreFields.amount_net,
      JSON.stringify(formData),
      JSON.stringify(paymentData || {})
    ]);
    
    console.log('[Database] Paid submission created/updated:', submissionId);
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Check if a submission already exists (for idempotency check)
 * 
 * @param {string} submissionId - The submission ID to check
 * @returns {Promise<boolean>} True if submission exists
 */
async function submissionExists(submissionId) {
  if (!submissionId) {
    return false;
  }
  
  const client = await getPool().connect();
  
  try {
    const result = await client.query(
      'SELECT 1 FROM submissions WHERE submission_id = $1 LIMIT 1',
      [submissionId]
    );
    return result.rows.length > 0;
  } finally {
    client.release();
  }
}

/**
 * Find a submission by submission_id
 * 
 * @param {string} submissionId - The submission ID to find
 * @returns {Promise<Object|null>} The submission or null if not found
 */
async function findBySubmissionId(submissionId) {
  if (!submissionId) {
    return null;
  }
  
  const client = await getPool().connect();
  
  try {
    const result = await client.query(
      'SELECT * FROM submissions WHERE submission_id = $1',
      [submissionId]
    );
    
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Check database connection health
 * 
 * @returns {Promise<Object>} Health status
 */
async function healthCheck() {
  const client = await getPool().connect();
  
  try {
    const result = await client.query('SELECT NOW() as time, version() as version');
    return {
      healthy: true,
      timestamp: result.rows[0].time,
      database: 'PostgreSQL (Neon)',
      version: result.rows[0].version.split(' ')[1]
    };
  } catch (error) {
    return {
      healthy: false,
      error: error.message
    };
  } finally {
    client.release();
  }
}

/**
 * Close the database connection pool
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[Database] Connection pool closed');
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Schema
  initializeSchema,
  
  // Pending form data (before payment)
  storePendingFormData,
  getPendingFormData,
  deletePendingFormData,
  cleanupExpiredPendingData,
  
  // Paid submissions (after payment COMPLETE)
  createPaidSubmission,
  submissionExists,
  findBySubmissionId,
  
  // Utilities
  healthCheck,
  closePool
};
