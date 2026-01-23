/**
 * PayFast Payment Redirect Handler
 * 
 * This Netlify serverless function generates a PayFast payment form and
 * automatically redirects users to PayFast for payment processing.
 * 
 * This approach keeps all merchant credentials server-side and never
 * exposes them to the client. The form action URL is also constructed
 * dynamically based on PAYFAST_MODE.
 * 
 * @module netlify/functions/payfast-redirect
 */

const { getPayFastConfig } = require('./utils/payfast-config');

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
// SITE_URL - The base URL of the site (e.g., https://example.netlify.app)
// NOTIFICATION_EMAIL - Email address for PayFast confirmations

/**
 * Main handler for PayFast payment redirect
 * 
 * @param {Object} event - Netlify function event object
 * @param {Object} context - Netlify function context object
 * @returns {Object} HTTP response object with auto-submitting form
 */
exports.handler = async function(event, context) {
  console.log('='.repeat(60));
  console.log('PayFast Redirect Request:', new Date().toISOString());
  console.log('='.repeat(60));

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
    // Step 1: Load and validate PayFast config
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
        body: JSON.stringify({ error: 'Server configuration error. Check environment variables.' })
      };
    }

    // ----------------------------------------
    // Step 2: Validate SITE_URL
    // ----------------------------------------
    const siteUrl = process.env.SITE_URL;
    if (!siteUrl) {
      console.error('ERROR: SITE_URL environment variable is required');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server configuration error. SITE_URL not set.' })
      };
    }

    // ----------------------------------------
    // Step 3: Parse request body
    // ----------------------------------------
    let requestData;
    try {
      if (event.headers['content-type']?.includes('application/json')) {
        requestData = JSON.parse(event.body);
      } else {
        // Parse URL-encoded form data
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

    // Log sanitized request data (no secrets)
    console.log('Request Data:', JSON.stringify({
      submissionId: requestData.submissionId || 'N/A',
      firstName: requestData.firstName || 'N/A',
      lastName: requestData.lastName || 'N/A',
      email: requestData.email ? '***@***' : 'N/A',
      businessName: requestData.businessName || 'N/A'
    }, null, 2));

    // ----------------------------------------
    // Step 4: Build PayFast form fields
    // ----------------------------------------
    const notificationEmail = process.env.NOTIFICATION_EMAIL || '';
    
    const formFields = {
      // Merchant credentials (from secure config)
      merchant_id: payfastConfig.merchantId,
      merchant_key: payfastConfig.merchantKey,
      
      // Transaction details
      amount: '0.00',
      item_name: 'Landing Page Subscription - First Month Free',
      item_description: 'Professional landing page design and hosting subscription',
      
      // Subscription details
      subscription_type: '1',
      recurring_amount: '499.99',
      frequency: '3',  // Monthly
      cycles: '0',     // Indefinite
      
      // Customer details
      name_first: requestData.firstName || '',
      name_last: requestData.lastName || '',
      email_address: requestData.email || '',
      cell_number: (requestData.phone || '').replace(/[\s\-\(\)]/g, ''),
      
      // Custom fields for tracking
      custom_str1: requestData.submissionId || '',
      custom_str2: requestData.businessName || '',
      custom_str3: requestData.timestamp || new Date().toISOString(),
      
      // URLs
      return_url: siteUrl + '/thank-you-page.html',
      cancel_url: siteUrl + '/subscribe.html',
      notify_url: siteUrl + '/.netlify/functions/payfast-itn',
      
      // Email confirmation
      email_confirmation: '1',
      confirmation_address: notificationEmail
    };

    // ----------------------------------------
    // Step 5: Generate auto-submitting HTML form
    // ----------------------------------------
    const formHtml = generateAutoSubmitForm(payfastConfig.processUrl, formFields);

    console.log('✓ Payment redirect form generated');
    console.log('='.repeat(60));

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
    console.error('Stack trace:', error.stack);

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
 * Generate HTML page with auto-submitting form
 * 
 * @param {string} actionUrl - The PayFast process URL
 * @param {Object} fields - Form field key-value pairs
 * @returns {string} Complete HTML page
 */
function generateAutoSubmitForm(actionUrl, fields) {
  // Build hidden input fields
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
    .container {
      text-align: center;
      padding: 2rem;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(255,255,255,0.1);
      border-top-color: #0a84ff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1.5rem;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    p {
      color: rgba(255,255,255,0.7);
      font-size: 0.95rem;
    }
    .fallback {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
    .fallback button {
      background: #0a84ff;
      color: white;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      font-size: 1rem;
      cursor: pointer;
      transition: background 0.2s;
    }
    .fallback button:hover {
      background: #0070e0;
    }
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
    // Auto-submit form after brief delay for visual feedback
    setTimeout(function() {
      document.getElementById('payfastForm').submit();
    }, 800);
  </script>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS
 * 
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  const htmlEscapes = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return str.replace(/[&<>"']/g, char => htmlEscapes[char]);
}
