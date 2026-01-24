/**
 * PayFast Payment Redirect Handler
 * 
 * Generates a PayFast payment form and redirects users to PayFast.
 * 
 * CRITICAL DATA FLOW:
 * 1. Receives FULL form data from subscribe.html (via localStorage)
 * 2. Stores COMPLETE form data in pending_form_data table (temporary)
 * 3. Redirects user to PayFast with minimal required fields
 * 4. ITN handler later retrieves full data from pending table
 * 
 * This ensures NO form data is lost between redirect and ITN.
 * 
 * @module netlify/functions/payfast-redirect
 */

const crypto = require('crypto');
const { getPayFastConfig } = require('./utils/payfast-config');
const { verifyRecaptcha } = require('./utils/recaptcha');
const { initializeSchema, storePendingFormData } = require('./utils/database');

/**
 * Main handler for PayFast payment redirect
 */
exports.handler = async function(event, context) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PayFast Redirect Request:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════════');

  // Only accept POST requests
  if (event.httpMethod !== 'POST') {
    console.log('ERROR: Invalid HTTP method:', event.httpMethod);
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
    };
  }

  try {
    // ----------------------------------------
    // Step 1: Load PayFast configuration
    // ----------------------------------------
    let payfastConfig;
    try {
      payfastConfig = getPayFastConfig();
      console.log('PayFast Mode:', payfastConfig.modeLabel);
    } catch (configError) {
      console.error('ERROR: PayFast configuration failed:', configError.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // ----------------------------------------
    // Step 2: Validate SITE_URL
    // ----------------------------------------
    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) {
      console.error('ERROR: SITE_URL not set');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // ----------------------------------------
    // Step 3: Parse request body (contains FULL form data)
    // ----------------------------------------
    let requestData;
    try {
      if (event.headers['content-type']?.includes('application/json')) {
        requestData = JSON.parse(event.body);
      } else {
        requestData = parseUrlEncodedData(event.body);
      }
    } catch (parseError) {
      console.error('ERROR: Failed to parse request body:', parseError.message);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid request body' })
      };
    }

    // Extract the full form data from the nested structure
    // subscribe.html sends: { submissionId, formData: {...}, timestamp, ... }
    const submissionId = requestData.submissionId || '';
    const fullFormData = requestData.formData || requestData; // Handle both formats
    const timestamp = requestData.timestamp || new Date().toISOString();

    // Log sanitized request data
    console.log('Request Data:', JSON.stringify({
      submissionId: submissionId || 'N/A',
      hasFormData: !!fullFormData,
      formDataKeys: Object.keys(fullFormData || {}),
      firstName: fullFormData?.ownerFirstName || 'N/A',
      lastName: fullFormData?.ownerLastName || 'N/A',
      email: fullFormData?.businessEmail ? '***@***' : 'N/A',
      hasRecaptcha: !!requestData.recaptchaToken
    }, null, 2));

    // Validate we have a submission ID
    if (!submissionId) {
      console.error('ERROR: No submissionId provided');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing submission ID' })
      };
    }

    // ----------------------------------------
    // Step 4: Validate reCAPTCHA v3 (if configured)
    // ----------------------------------------
    const recaptchaToken = requestData.recaptchaToken || requestData['g-recaptcha-response'];
    const clientIp = event.headers['x-forwarded-for']?.split(',')[0] || 
                     event.headers['client-ip'] || 
                     null;
    
    const recaptchaResult = await verifyRecaptcha(recaptchaToken, 'submit_payment', clientIp);
    
    if (!recaptchaResult.success && !recaptchaResult.skipped) {
      console.log('ERROR: reCAPTCHA verification failed:', recaptchaResult.error);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Security verification failed. Please try again.' })
      };
    }
    
    if (recaptchaResult.skipped) {
      console.log('INFO: reCAPTCHA skipped (not configured)');
    } else {
      console.log(`✓ reCAPTCHA verified (score: ${recaptchaResult.score})`);
    }

    // ----------------------------------------
    // Step 5: Store FULL form data in pending table
    // This is CRITICAL - ensures no data is lost
    // ----------------------------------------
    try {
      await initializeSchema();
      
      // Store the COMPLETE form data with all fields
      const pendingData = {
        ...fullFormData,
        submissionId: submissionId,
        timestamp: timestamp,
        metadata: requestData.metadata || {}
      };
      
      await storePendingFormData(submissionId, pendingData);
      console.log('✓ Full form data stored in pending table');
      console.log('  Fields stored:', Object.keys(pendingData).length);
    } catch (dbError) {
      // CRITICAL: If we can't store the form data, we should NOT proceed
      // Otherwise the ITN won't be able to retrieve the full data
      console.error('ERROR: Failed to store pending form data:', dbError.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to prepare payment. Please try again.' })
      };
    }

    // ----------------------------------------
    // Step 6: Build PayFast form fields
    // ----------------------------------------
    const notificationEmail = process.env.NOTIFICATION_EMAIL || '';
    
    // Extract customer details from form data
    const firstName = fullFormData.ownerFirstName || '';
    const lastName = fullFormData.ownerLastName || '';
    const email = fullFormData.businessEmail || '';
    const phone = (fullFormData.businessPhone || '').replace(/[\s\-\(\)]/g, '');
    const businessName = fullFormData.businessName || '';
    
    // Build fields in PayFast's required order for signature
    const formFields = {
      // 1. Merchant details
      merchant_id: payfastConfig.merchantId,
      merchant_key: payfastConfig.merchantKey,
      return_url: siteUrl + '/thank-you-page.html',
      cancel_url: siteUrl + '/subscribe.html',
      notify_url: siteUrl + '/.netlify/functions/payfast-itn',
      
      // 2. Customer details
      name_first: firstName,
      name_last: lastName,
      email_address: email,
      cell_number: phone,
      
      // 3. Transaction details
      m_payment_id: submissionId,
      amount: '0.00',
      item_name: 'Landing Page Subscription - First Month Free',
      item_description: 'Professional landing page design and hosting subscription',
      
      // 4. Custom fields for tracking
      // IMPORTANT: custom_str1 MUST be submissionId for ITN to find pending data
      custom_str1: submissionId,
      custom_str2: businessName,
      custom_str3: timestamp,
      
      // 5. Transaction options
      email_confirmation: '1',
      confirmation_address: notificationEmail,
      
      // 6. Subscription details (Recurring Billing)
      subscription_type: '1',
      recurring_amount: '499.99',
      frequency: '3',  // Monthly
      cycles: '0'      // Indefinite
    };

    // ----------------------------------------
    // Step 7: Generate PayFast signature
    // ----------------------------------------
    const signature = generatePayFastSignature(formFields, payfastConfig.passphrase);
    formFields.signature = signature;
    console.log('✓ PayFast signature generated');

    // ----------------------------------------
    // Step 8: Generate auto-submitting HTML form
    // ----------------------------------------
    const formHtml = generateAutoSubmitForm(payfastConfig.processUrl, formFields);
    console.log('✓ Payment redirect form generated');
    console.log('═══════════════════════════════════════════════════════════════');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      },
      body: formHtml
    };

  } catch (error) {
    console.error('ERROR: Payment redirect failed:', error.message);
    console.error('Stack:', error.stack);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse URL-encoded form data
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
 * Generate HTML page with auto-submitting form
 */
function generateAutoSubmitForm(actionUrl, fields) {
  const hiddenFields = Object.entries(fields)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([name, value]) => {
      const escapedValue = escapeHtml(String(value));
      return `    <input type="hidden" name="${name}" value="${escapedValue}"/>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="robots" content="noindex,nofollow"/>
  <title>Redirecting to Payment...</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0a0a1a 0%, #1a1a3a 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #ffffff;
    }
    .container { text-align: center; padding: 2rem; }
    .spinner {
      width: 48px; height: 48px;
      border: 4px solid rgba(255,255,255,0.1);
      border-top-color: #0a84ff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1.5rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.75rem; }
    p { color: rgba(255,255,255,0.7); font-size: 0.95rem; }
    .fallback { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1); }
    .fallback button {
      background: #0a84ff; color: white; border: none;
      padding: 0.75rem 1.5rem; border-radius: 0.5rem;
      font-size: 1rem; cursor: pointer; transition: background 0.2s;
    }
    .fallback button:hover { background: #0070e0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <h1>Redirecting to Secure Payment</h1>
    <p>Please wait while we connect you to PayFast...</p>
    
    <form id="payfastForm" method="POST" action="${escapeHtml(actionUrl)}">
${hiddenFields}
      <div class="fallback">
        <p style="margin-bottom: 1rem;">If you are not redirected automatically:</p>
        <button type="submit">Continue to Payment</button>
      </div>
    </form>
  </div>

  <script>
    setTimeout(function() {
      document.getElementById('payfastForm').submit();
    }, 800);
  </script>
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  const htmlEscapes = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  };
  return str.replace(/[&<>"']/g, char => htmlEscapes[char]);
}

/**
 * Generate PayFast security signature
 */
function generatePayFastSignature(data, passphrase) {
  const paramString = Object.entries(data)
    .filter(([key, value]) => value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => {
      const encoded = encodeURIComponent(String(value).trim()).replace(/%20/g, '+');
      return `${key}=${encoded}`;
    })
    .join('&');

  const stringToHash = passphrase 
    ? `${paramString}&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`
    : paramString;

  return crypto.createHash('md5').update(stringToHash).digest('hex');
}
