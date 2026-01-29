/**
 * Manual ITN Test Endpoint (TEMPORARY - DELETE AFTER TESTING)
 * 
 * This endpoint allows you to manually test the ITN processing
 * by providing a submission ID that exists in pending_form_data.
 * 
 * Usage: 
 *   GET  - List all pending and submissions records
 *   POST - Process a specific submission ID
 * 
 * DELETE THIS FILE after testing is complete!
 */

const { 
  initializeSchema, 
  getPendingFormData, 
  deletePendingFormData,
  createPaidSubmission,
  submissionExists
} = require('./utils/database');
const { sendFullFormNotificationEmail, sendWelcomeEmail } = require('./utils/email-sender');

// Get database pool for direct queries
const { Pool } = require('pg');

function getPool() {
  const connectionString = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('No database connection string found');
  }
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    max: 1
  });
}

exports.handler = async function(event, context) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('TEST ITN Endpoint:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════════');

  // GET request - list all records
  if (event.httpMethod === 'GET') {
    try {
      const pool = getPool();
      
      // Get pending records
      const pendingResult = await pool.query(
        'SELECT submission_id, created_at, expires_at FROM pending_form_data ORDER BY created_at DESC LIMIT 10'
      );
      
      // Get submission records
      const submissionsResult = await pool.query(
        'SELECT submission_id, created_at, payment_status FROM submissions ORDER BY created_at DESC LIMIT 10'
      );
      
      await pool.end();
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Database Status',
          pending_form_data: {
            count: pendingResult.rows.length,
            records: pendingResult.rows
          },
          submissions: {
            count: submissionsResult.rows.length,
            records: submissionsResult.rows
          }
        }, null, 2)
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error.message })
      };
    }
  }

  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Test ITN Endpoint',
        usage: 'POST with { "submissionId": "SSS-20260126-XXXXX" }',
        warning: 'DELETE this file after testing!'
      })
    };
  }

  try {
    // Parse request
    const requestData = JSON.parse(event.body || '{}');
    const submissionId = requestData.submissionId;

    if (!submissionId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'submissionId is required' })
      };
    }

    console.log('Testing submission:', submissionId);

    // Check environment variables
    const envCheck = {
      NETLIFY_DATABASE_URL: !!process.env.NETLIFY_DATABASE_URL,
      DATABASE_URL: !!process.env.DATABASE_URL,
      EMAIL_API_KEY: !!process.env.EMAIL_API_KEY,
      EMAIL_SERVICE: process.env.EMAIL_SERVICE || 'NOT SET',
      NOTIFICATION_EMAIL: process.env.NOTIFICATION_EMAIL || 'NOT SET',
      FROM_EMAIL: process.env.FROM_EMAIL || 'NOT SET'
    };
    console.log('Environment check:', JSON.stringify(envCheck, null, 2));

    // Initialize database
    await initializeSchema();
    console.log('✓ Database schema initialized');

    // Check if already exists in submissions
    const alreadyExists = await submissionExists(submissionId);
    if (alreadyExists) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Submission already exists in submissions table',
          submissionId: submissionId,
          action: 'none'
        })
      };
    }

    // Get pending form data
    const pendingRecord = await getPendingFormData(submissionId);
    
    if (!pendingRecord) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'No pending form data found',
          submissionId: submissionId
        })
      };
    }

    console.log('✓ Found pending record');

    // Parse form data
    const fullFormData = typeof pendingRecord.form_data === 'string' 
      ? JSON.parse(pendingRecord.form_data) 
      : pendingRecord.form_data;

    console.log('Form data fields:', Object.keys(fullFormData).length);

    // Create mock payment data for testing
    const mockPaymentData = {
      pf_payment_id: 'TEST-' + Date.now(),
      payment_status: 'COMPLETE',
      amount_gross: '0.00',
      amount_fee: '0.00',
      amount_net: '0.00',
      name_first: fullFormData.ownerFirstName || 'Test',
      name_last: fullFormData.ownerLastName || 'User',
      email_address: fullFormData.businessEmail || 'test@test.com',
      m_payment_id: submissionId,
      item_name: 'Landing Page Subscription - Test',
      billing_date: new Date().toISOString().split('T')[0]
    };

    // Step 1: Create paid submission
    let dbSuccess = false;
    try {
      await createPaidSubmission({
        submissionId: submissionId,
        formData: fullFormData,
        paymentData: mockPaymentData
      });
      dbSuccess = true;
      console.log('✓ Created paid submission in database');
    } catch (dbError) {
      console.error('✗ Database error:', dbError.message);
    }

    // Step 2: Send owner notification email
    let ownerEmailSuccess = false;
    let ownerEmailError = null;
    try {
      await sendFullFormNotificationEmail(submissionId, fullFormData, mockPaymentData);
      ownerEmailSuccess = true;
      console.log('✓ Owner notification email sent');
    } catch (emailError) {
      ownerEmailError = emailError.message;
      console.error('✗ Owner email error:', emailError.message);
    }

    // Step 3: Send welcome email to customer
    let customerEmailSuccess = false;
    let customerEmailError = null;
    try {
      await sendWelcomeEmail(fullFormData);
      customerEmailSuccess = true;
      console.log('✓ Customer welcome email sent');
    } catch (emailError) {
      customerEmailError = emailError.message;
      console.error('✗ Customer email error:', emailError.message);
    }

    // Step 4: Delete pending record (only if DB save succeeded)
    let cleanupSuccess = false;
    if (dbSuccess) {
      try {
        await deletePendingFormData(submissionId);
        cleanupSuccess = true;
        console.log('✓ Deleted pending record');
      } catch (cleanupError) {
        console.error('✗ Cleanup error:', cleanupError.message);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Test ITN processing complete',
        submissionId: submissionId,
        results: {
          databaseSave: dbSuccess ? '✓ Success' : '✗ Failed',
          ownerEmail: ownerEmailSuccess ? '✓ Sent' : `✗ Failed: ${ownerEmailError}`,
          customerEmail: customerEmailSuccess ? '✓ Sent' : `✗ Failed: ${customerEmailError}`,
          pendingCleanup: cleanupSuccess ? '✓ Cleaned' : '✗ Skipped'
        },
        environmentCheck: envCheck
      }, null, 2)
    };

  } catch (error) {
    console.error('TEST ITN Error:', error.message);
    console.error('Stack:', error.stack);
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message,
        stack: error.stack
      })
    };
  }
};
