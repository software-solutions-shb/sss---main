/**
 * PayFast ITN (Instant Transaction Notification) Handler
 * 
 * CRITICAL DATA FLOW:
 * 1. Receives ITN from PayFast with payment status
 * 2. Validates signature and payment with PayFast server
 * 3. IF AND ONLY IF payment_status === 'COMPLETE':
 *    a. Retrieves FULL form data from pending_form_data table
 *    b. Creates submission in main submissions table (with complete form_data JSONB)
 *    c. Sends comprehensive notification email to owner with ALL form fields
 *    d. Sends welcome email to customer
 *    e. Deletes pending record (cleanup)
 * 4. If payment NOT complete: do nothing, no data persisted
 * 
 * GUARANTEES:
 * - submissions table ONLY contains paid customers
 * - form_data JSONB contains EVERY field from the original form
 * - Idempotent: duplicate ITNs don't create duplicate records
 * - Non-blocking: email failures don't affect database writes
 * 
 * @module netlify/functions/payfast-itn
 */

const { validatePayFastSignature, validatePayFastRequest } = require('./utils/payfast-validator');
const { 
  initializeSchema, 
  getPendingFormData, 
  deletePendingFormData,
  createPaidSubmission,
  submissionExists
} = require('./utils/database');
const { sendFullFormNotificationEmail, sendWelcomeEmail } = require('./utils/email-sender');
const { getPayFastCredentials } = require('./utils/payfast-config');

/**
 * Main handler for PayFast ITN webhook
 */
exports.handler = async function(event, context) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PayFast ITN Received:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════════');

  // ----------------------------------------
  // Step 1: Only accept POST requests
  // ----------------------------------------
  if (event.httpMethod !== 'POST') {
    console.log('ERROR: Invalid HTTP method:', event.httpMethod);
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    // ----------------------------------------
    // Step 2: Load PayFast configuration
    // ----------------------------------------
    let payfastConfig;
    try {
      payfastConfig = getPayFastCredentials();
      console.log('PayFast Mode:', payfastConfig.modeLabel);
    } catch (configError) {
      console.error('ERROR: PayFast configuration failed:', configError.message);
      return {
        statusCode: 200,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // ----------------------------------------
    // Step 3: Parse the ITN data
    // ----------------------------------------
    const itnData = parseUrlEncodedData(event.body);
    console.log('ITN Data:', JSON.stringify(sanitizeLogData(itnData), null, 2));

    // ----------------------------------------
    // Step 4: Validate PayFast signature
    // ----------------------------------------
    const isValidSignature = validatePayFastSignature(itnData, payfastConfig.passphrase);

    if (!isValidSignature) {
      console.log('ERROR: Invalid PayFast signature');
      return {
        statusCode: 200,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }
    console.log('✓ PayFast signature validated');

    // ----------------------------------------
    // Step 5: Validate payment amount
    // ----------------------------------------
    const amountGross = parseFloat(itnData.amount_gross || '0');
    const expectedInitialAmount = 0.00;
    const expectedRecurringAmount = 499.99;
    
    const isInitialPayment = Math.abs(amountGross - expectedInitialAmount) < 0.01;
    const isRecurringPayment = Math.abs(amountGross - expectedRecurringAmount) < 0.01;
    
    if (isInitialPayment) {
      console.log('✓ Initial payment (R0.00 - First month free)');
    } else if (isRecurringPayment) {
      console.log('✓ Recurring payment (R499.99)');
    } else {
      console.log('WARNING: Unexpected payment amount:', amountGross);
    }

    // ----------------------------------------
    // Step 6: Validate with PayFast server
    // ----------------------------------------
    const validationResult = await validatePayFastRequest(itnData, payfastConfig.merchantId);

    if (!validationResult.valid) {
      console.log('ERROR: PayFast validation failed:', validationResult.error);
      return {
        statusCode: 200,
        body: JSON.stringify({ error: validationResult.error })
      };
    }
    console.log('✓ PayFast server validation passed');

    // ----------------------------------------
    // Step 7: Check payment status
    // CRITICAL: Only proceed if COMPLETE
    // ----------------------------------------
    const paymentStatus = itnData.payment_status;
    console.log('Payment Status:', paymentStatus);

    if (paymentStatus !== 'COMPLETE') {
      // DO NOT store anything for incomplete payments
      console.log('INFO: Payment not complete, status:', paymentStatus);
      console.log('ACTION: No data persisted (only COMPLETE payments are stored)');
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'ITN received',
          status: paymentStatus,
          action: 'no_action_required'
        })
      };
    }
    console.log('✓ Payment status is COMPLETE');

    // ----------------------------------------
    // Step 8: Extract submission ID from custom_str1
    // ----------------------------------------
    const submissionId = itnData.custom_str1 || '';
    
    if (!submissionId) {
      console.error('ERROR: No submissionId in custom_str1');
      return {
        statusCode: 200,
        body: JSON.stringify({ error: 'Missing submission ID' })
      };
    }
    console.log('Submission ID:', submissionId);

    // ----------------------------------------
    // Step 9: Check for idempotency (prevent duplicate processing)
    // ----------------------------------------
    const alreadyExists = await submissionExists(submissionId);
    if (alreadyExists) {
      console.log('INFO: Submission already exists (duplicate ITN):', submissionId);
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Duplicate ITN - already processed',
          submissionId: submissionId
        })
      };
    }

    // ----------------------------------------
    // Step 10: Initialize database schema
    // ----------------------------------------
    await initializeSchema();

    // ----------------------------------------
    // Step 11: Retrieve FULL form data from pending table
    // ----------------------------------------
    console.log('Retrieving full form data from pending table...');
    const pendingRecord = await getPendingFormData(submissionId);
    
    if (!pendingRecord) {
      console.error('ERROR: No pending form data found for:', submissionId);
      console.log('RECOVERY: Storing minimal data from ITN');
      
      // Fallback: store what we have from ITN (not ideal, but better than losing the payment)
      const fallbackFormData = {
        submissionId: submissionId,
        businessName: itnData.custom_str2 || '',
        ownerFirstName: itnData.name_first || '',
        ownerLastName: itnData.name_last || '',
        businessEmail: itnData.email_address || '',
        _note: 'INCOMPLETE DATA - Original form data not found in pending table'
      };
      
      await createPaidSubmission({
        submissionId: submissionId,
        formData: fallbackFormData,
        paymentData: itnData
      });
      
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'ITN processed with fallback data',
          submissionId: submissionId,
          warning: 'Original form data not found'
        })
      };
    }

    // Parse the form_data JSONB
    const fullFormData = typeof pendingRecord.form_data === 'string' 
      ? JSON.parse(pendingRecord.form_data) 
      : pendingRecord.form_data;
    
    console.log('✓ Full form data retrieved');
    console.log('  Form fields:', Object.keys(fullFormData).length);

    // ----------------------------------------
    // Step 12: Create paid submission (NON-BLOCKING but logged)
    // ----------------------------------------
    let databaseSaveSuccess = false;
    let savedSubmission = null;
    
    try {
      savedSubmission = await createPaidSubmission({
        submissionId: submissionId,
        formData: fullFormData,
        paymentData: itnData
      });
      databaseSaveSuccess = true;
      console.log('✓ Paid submission saved to database');
    } catch (dbError) {
      console.error('ERROR: Database save failed:', dbError.message);
      console.log('RECOVERY DATA:', JSON.stringify({
        submissionId: submissionId,
        formDataKeys: Object.keys(fullFormData),
        paymentId: itnData.pf_payment_id
      }));
    }

    // ----------------------------------------
    // Step 13: Send FULL notification email to OWNER (NON-BLOCKING)
    // ----------------------------------------
    let ownerEmailSent = false;
    try {
      await sendFullFormNotificationEmail(submissionId, fullFormData, itnData);
      ownerEmailSent = true;
      console.log('✓ Full form notification email sent to owner');
    } catch (emailError) {
      console.error('ERROR: Owner notification email failed:', emailError.message);
    }

    // ----------------------------------------
    // Step 14: Send welcome email to CUSTOMER (NON-BLOCKING)
    // ----------------------------------------
    let customerEmailSent = false;
    const customerEmail = fullFormData.businessEmail;
    
    if (customerEmail) {
      try {
        await sendWelcomeEmail({
          email: customerEmail,
          firstName: fullFormData.ownerFirstName || '',
          lastName: fullFormData.ownerLastName || '',
          businessName: fullFormData.businessName || '',
          submissionId: submissionId
        });
        customerEmailSent = true;
        console.log('✓ Welcome email sent to customer');
      } catch (customerEmailError) {
        console.error('ERROR: Customer welcome email failed:', customerEmailError.message);
      }
    } else {
      console.log('INFO: No customer email available, skipping welcome email');
    }

    // ----------------------------------------
    // Step 15: Delete pending record (cleanup)
    // ----------------------------------------
    try {
      await deletePendingFormData(submissionId);
      console.log('✓ Pending form data cleaned up');
    } catch (cleanupError) {
      console.error('ERROR: Pending cleanup failed:', cleanupError.message);
      // Not critical - will be cleaned up by expiry
    }

    // ----------------------------------------
    // Step 16: Return success to PayFast
    // ----------------------------------------
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('ITN Processing Complete');
    console.log('  Submission ID:', submissionId);
    console.log('  Database:', databaseSaveSuccess ? 'SAVED' : 'FAILED');
    console.log('  Owner email:', ownerEmailSent ? 'SENT' : 'FAILED');
    console.log('  Customer email:', customerEmailSent ? 'SENT' : (customerEmail ? 'FAILED' : 'SKIPPED'));
    console.log('  Form fields stored:', Object.keys(fullFormData).length);
    console.log('═══════════════════════════════════════════════════════════════');

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'ITN processed successfully',
        submissionId: submissionId,
        databaseSaved: databaseSaveSuccess,
        ownerEmailSent: ownerEmailSent,
        customerEmailSent: customerEmailSent
      })
    };

  } catch (error) {
    console.error('ERROR: ITN processing failed:', error.message);
    console.error('Stack:', error.stack);

    // ALWAYS return 200 to prevent PayFast from retrying
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'ITN received with errors',
        error: error.message
      })
    };
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse URL-encoded form data into an object
 */
function parseUrlEncodedData(body) {
  const params = new URLSearchParams(body);
  const data = {};
  for (const [key, value] of params.entries()) {
    data[key] = value;
  }
  return data;
}

/**
 * Sanitize data for logging (mask sensitive fields)
 */
function sanitizeLogData(data) {
  const sanitized = { ...data };
  if (sanitized.signature) sanitized.signature = '***MASKED***';
  if (sanitized.token) sanitized.token = sanitized.token.substring(0, 8) + '***';
  return sanitized;
}
