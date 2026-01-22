/**
 * PayFast ITN (Instant Transaction Notification) Handler
 * 
 * This Netlify serverless function receives payment notifications from PayFast,
 * validates them, and processes successful subscriptions by:
 * 1. Validating the PayFast signature
 * 2. Confirming payment status is COMPLETE
 * 3. Extracting the submission ID from custom fields
 * 4. Appending subscriber data to Airtable
 * 5. Sending email notification to business owner
 * 
 * Configuration is derived dynamically from PAYFAST_MODE environment variable.
 * 
 * @module netlify/functions/payfast-itn
 */

const { validatePayFastSignature, validatePayFastRequest } = require('./utils/payfast-validator');
const { appendToAirtable } = require('./utils/airtable');
const { sendNotificationEmail } = require('./utils/email-sender');
const { getPayFastCredentials, getPayFastModeLabel, logConfigStatus } = require('./utils/payfast-config');

// ============================================
// ENVIRONMENT VARIABLES (set in Netlify dashboard)
// ============================================
// PAYFAST_MODE - Must be "sandbox" or "live"
// 
// For sandbox mode:
//   PAYFAST_SANDBOX_MERCHANT_ID
//   PAYFAST_SANDBOX_MERCHANT_KEY
//   PAYFAST_SANDBOX_PASSPHRASE
// 
// For live mode:
//   PAYFAST_LIVE_MERCHANT_ID
//   PAYFAST_LIVE_MERCHANT_KEY
//   PAYFAST_LIVE_PASSPHRASE
// 
// Other required variables:
//   AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME
//   EMAIL_API_KEY, EMAIL_SERVICE, NOTIFICATION_EMAIL, FROM_EMAIL

/**
 * Main handler for PayFast ITN webhook
 * 
 * @param {Object} event - Netlify function event object
 * @param {Object} context - Netlify function context object
 * @returns {Object} HTTP response object
 */
exports.handler = async function(event, context) {
  console.log('='.repeat(60));
  console.log('PayFast ITN Received:', new Date().toISOString());
  console.log('='.repeat(60));

  // ----------------------------------------
  // Step 1: Only accept POST requests
  // ----------------------------------------
  if (event.httpMethod !== 'POST') {
    console.log('ERROR: Invalid HTTP method:', event.httpMethod);
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // ----------------------------------------
    // Step 1.5: Load and validate PayFast config
    // ----------------------------------------
    let payfastConfig;
    try {
      payfastConfig = getPayFastCredentials();
      console.log('PayFast Mode:', payfastConfig.modeLabel);
    } catch (configError) {
      console.error('ERROR: PayFast configuration failed:', configError.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // ----------------------------------------
    // Step 2: Parse the ITN data
    // ----------------------------------------
    let itnData;
    
    // PayFast sends data as URL-encoded form data
    if (event.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
      itnData = parseUrlEncodedData(event.body);
    } else {
      // Try to parse as JSON as fallback
      try {
        itnData = JSON.parse(event.body);
      } catch (e) {
        itnData = parseUrlEncodedData(event.body);
      }
    }

    console.log('Parsed ITN Data:', JSON.stringify(sanitizeLogData(itnData), null, 2));

    // ----------------------------------------
    // Step 3: Validate PayFast signature
    // ----------------------------------------
    const isValidSignature = validatePayFastSignature(itnData, payfastConfig.passphrase);

    if (!isValidSignature) {
      console.log('ERROR: Invalid PayFast signature');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }
    console.log('✓ PayFast signature validated');

    // ----------------------------------------
    // Step 4: Validate the PayFast request
    // ----------------------------------------
    const validationResult = await validatePayFastRequest(itnData, payfastConfig.merchantId);

    if (!validationResult.valid) {
      console.log('ERROR: PayFast validation failed:', validationResult.error);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: validationResult.error })
      };
    }
    console.log('✓ PayFast request validated');

    // ----------------------------------------
    // Step 5: Check payment status
    // ----------------------------------------
    const paymentStatus = itnData.payment_status;
    console.log('Payment Status:', paymentStatus);

    if (paymentStatus !== 'COMPLETE') {
      console.log('INFO: Payment not complete, status:', paymentStatus);
      // Still return 200 to acknowledge receipt
      // PayFast may send multiple notifications for different statuses
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
    // Step 6: Extract submission ID and data
    // ----------------------------------------
    const submissionId = itnData.custom_str1 || '';
    const subscriberData = extractSubscriberData(itnData);

    if (!submissionId) {
      console.log('WARNING: No submission ID found in custom_str1');
    }

    console.log('Submission ID:', submissionId);
    console.log('Subscriber Data:', JSON.stringify(subscriberData, null, 2));

    // ----------------------------------------
    // Step 7: Append to Airtable
    // ----------------------------------------
    try {
      await appendToAirtable(subscriberData);
      console.log('✓ Data appended to Airtable');
    } catch (airtableError) {
      console.error('ERROR: Failed to append to Airtable:', airtableError.message);
      // Continue processing - don't fail the whole request
    }

    // ----------------------------------------
    // Step 8: Send email notification
    // ----------------------------------------
    try {
      await sendNotificationEmail(subscriberData);
      console.log('✓ Notification email sent');
    } catch (emailError) {
      console.error('ERROR: Failed to send notification email:', emailError.message);
      // Continue processing - don't fail the whole request
    }

    // ----------------------------------------
    // Step 9: Return success to PayFast
    // ----------------------------------------
    console.log('='.repeat(60));
    console.log('ITN Processing Complete - Success');
    console.log('='.repeat(60));

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'ITN processed successfully',
        submissionId: submissionId
      })
    };

  } catch (error) {
    console.error('ERROR: ITN processing failed:', error.message);
    console.error('Stack trace:', error.stack);

    // Return 200 to prevent PayFast from retrying
    // Log the error for investigation
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
 * 
 * @param {string} body - URL-encoded string
 * @returns {Object} Parsed key-value object
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
 * Extract subscriber data from ITN payload
 * Maps PayFast fields to our data structure
 * 
 * @param {Object} itnData - PayFast ITN data
 * @returns {Object} Structured subscriber data
 */
function extractSubscriberData(itnData) {
  return {
    // Timestamp for the record
    timestamp: new Date().toISOString(),
    
    // Submission ID from our form
    submissionId: itnData.custom_str1 || '',
    
    // PayFast transaction details
    pfPaymentId: itnData.pf_payment_id || '',
    paymentStatus: itnData.payment_status || '',
    
    // Subscriber information from PayFast
    // Note: These come from PayFast's records
    firstName: itnData.name_first || '',
    lastName: itnData.name_last || '',
    email: itnData.email_address || '',
    
    // Payment details
    amountGross: itnData.amount_gross || '',
    amountFee: itnData.amount_fee || '',
    amountNet: itnData.amount_net || '',
    
    // Subscription details
    itemName: itnData.item_name || '',
    itemDescription: itnData.item_description || '',
    
    // Custom fields (we can use these to pass additional data)
    // custom_str1 = Submission ID
    // custom_str2-5 can be used for additional data if needed
    customStr2: itnData.custom_str2 || '',
    customStr3: itnData.custom_str3 || '',
    customStr4: itnData.custom_str4 || '',
    customStr5: itnData.custom_str5 || '',
    
    // Subscription token (for recurring payments)
    token: itnData.token || '',
    
    // Billing date for subscription
    billingDate: itnData.billing_date || ''
  };
}

/**
 * Sanitize ITN data for logging (remove sensitive info)
 * 
 * @param {Object} data - ITN data object
 * @returns {Object} Sanitized data safe for logging
 */
function sanitizeLogData(data) {
  const sanitized = { ...data };
  
  // Mask sensitive fields
  if (sanitized.signature) {
    sanitized.signature = '***MASKED***';
  }
  if (sanitized.token) {
    sanitized.token = sanitized.token.substring(0, 8) + '***';
  }
  
  return sanitized;
}
