/**
 * Email Notification Utility
 * 
 * Sends email notifications when a new subscriber completes payment.
 * Uses Resend API (recommended for serverless) or SendGrid as alternatives.
 * 
 * @module netlify/functions/utils/email-sender
 */

const https = require('https');

// ============================================
// ENVIRONMENT VARIABLES REQUIRED:
// ============================================
// EMAIL_API_KEY - API key for email service (Resend or SendGrid)
// EMAIL_SERVICE - Must be 'resend' or 'sendgrid' (required, no default)
// NOTIFICATION_EMAIL - Email address to receive notifications
// FROM_EMAIL - Sender email address (must be verified with email service)

/**
 * Send notification email about new subscriber
 * 
 * @param {Object} subscriberData - The subscriber data from PayFast ITN
 * @returns {Promise<Object>} Email API response
 */
async function sendNotificationEmail(subscriberData) {
  const apiKey = process.env.EMAIL_API_KEY;
  const notificationEmail = process.env.NOTIFICATION_EMAIL;
  const fromEmail = process.env.FROM_EMAIL;
  const emailService = process.env.EMAIL_SERVICE;

  if (!apiKey) {
    throw new Error('EMAIL_API_KEY environment variable is required but not set.');
  }

  if (!notificationEmail) {
    throw new Error('NOTIFICATION_EMAIL environment variable is required but not set.');
  }

  if (!fromEmail) {
    throw new Error('FROM_EMAIL environment variable is required but not set.');
  }

  if (!emailService) {
    throw new Error('EMAIL_SERVICE environment variable is required but not set. Use "resend" or "sendgrid".');
  }

  const normalizedService = emailService.toLowerCase();
  if (normalizedService !== 'resend' && normalizedService !== 'sendgrid') {
    throw new Error('EMAIL_SERVICE must be "resend" or "sendgrid".');
  }

  // Build email content
  const emailContent = buildEmailContent(subscriberData);

  console.log('Sending notification email to:', notificationEmail);
  console.log('Using email service:', normalizedService);

  // Send via configured service
  if (normalizedService === 'sendgrid') {
    return sendViaSendGrid(apiKey, fromEmail, notificationEmail, emailContent);
  } else {
    return sendViaResend(apiKey, fromEmail, notificationEmail, emailContent);
  }
}

/**
 * Build email content from subscriber data
 * 
 * @param {Object} data - Subscriber data
 * @returns {Object} Email subject and body content
 */
function buildEmailContent(data) {
  const subject = '🎉 New Subscriber Notification';

  // Plain text version
  const textBody = `
NEW SUBSCRIBER NOTIFICATION
============================

A new subscriber has completed payment!

SUBMISSION DETAILS
------------------
Submission ID: ${data.submissionId || 'N/A'}
Payment ID: ${data.pfPaymentId || 'N/A'}
Payment Status: ${data.paymentStatus || 'N/A'}
Timestamp: ${data.timestamp || new Date().toISOString()}

SUBSCRIBER INFORMATION
----------------------
Name: ${data.firstName || ''} ${data.lastName || ''}
Email: ${data.email || 'N/A'}

PAYMENT DETAILS
---------------
Amount: R${data.amountGross || '0.00'}
Net Amount: R${data.amountNet || '0.00'}
Item: ${data.itemName || 'Landing Page Subscription'}

SUBSCRIPTION
------------
Token: ${data.token ? data.token.substring(0, 12) + '...' : 'N/A'}
Next Billing: ${data.billingDate || 'N/A'}

---
This is an automated notification from Software Solutions Services.
`.trim();

  // HTML version
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>New Subscriber Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0a84ff 0%, #1f5fff 100%); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 600;">🎉 New Subscriber!</h1>
      <p style="margin: 10px 0 0; opacity: 0.9;">Software Solutions Services</p>
    </div>
    
    <!-- Content -->
    <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
      
      <p style="color: #333; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
        A new subscriber has completed payment. Here are the details:
      </p>
      
      <!-- Submission Info -->
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <h3 style="margin: 0 0 15px; color: #0a84ff; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Submission Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Submission ID:</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px; font-weight: 600; font-family: monospace;">${data.submissionId || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Payment ID:</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px;">${data.pfPaymentId || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Status:</td>
            <td style="padding: 8px 0; color: #22c55e; font-size: 14px; font-weight: 600;">${data.paymentStatus || 'N/A'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Timestamp:</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px;">${data.timestamp || new Date().toISOString()}</td>
          </tr>
        </table>
      </div>
      
      <!-- Subscriber Info -->
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <h3 style="margin: 0 0 15px; color: #0a84ff; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Subscriber Information</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Name:</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px; font-weight: 600;">${data.firstName || ''} ${data.lastName || ''}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Email:</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px;">
              <a href="mailto:${data.email}" style="color: #0a84ff; text-decoration: none;">${data.email || 'N/A'}</a>
            </td>
          </tr>
        </table>
      </div>
      
      <!-- Payment Info -->
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
        <h3 style="margin: 0 0 15px; color: #0a84ff; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Payment Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Amount:</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px; font-weight: 600;">R${data.amountGross || '0.00'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Net (after fees):</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px;">R${data.amountNet || '0.00'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Item:</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px;">${data.itemName || 'Landing Page Subscription'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">Next Billing:</td>
            <td style="padding: 8px 0; color: #333; font-size: 14px;">${data.billingDate || 'N/A'}</td>
          </tr>
        </table>
      </div>
      
      <!-- CTA -->
      <div style="text-align: center; margin-top: 30px;">
        <p style="color: #666; font-size: 14px; margin: 0 0 15px;">
          Please contact the subscriber within 24 hours to begin onboarding.
        </p>
      </div>
      
    </div>
    
    <!-- Footer -->
    <div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">
      <p style="margin: 0;">This is an automated notification from Software Solutions Services</p>
      <p style="margin: 5px 0 0;">© ${new Date().getFullYear()} Software Solutions Services</p>
    </div>
    
  </div>
</body>
</html>
`.trim();

  return { subject, textBody, htmlBody };
}

/**
 * Send email via Resend API
 * 
 * @param {string} apiKey - Resend API key
 * @param {string} from - Sender email
 * @param {string} to - Recipient email
 * @param {Object} content - Email content
 * @returns {Promise<Object>} API response
 */
function sendViaResend(apiKey, from, to, content) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      from: from,
      to: [to],
      subject: content.subject,
      text: content.textBody,
      html: content.htmlBody
    });

    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        console.log('Resend API response:', res.statusCode, responseData);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseData));
        } else {
          reject(new Error(`Resend API error: ${res.statusCode} - ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Resend API request timeout'));
    });

    req.write(data);
    req.end();
  });
}

/**
 * Send email via SendGrid API
 * 
 * @param {string} apiKey - SendGrid API key
 * @param {string} from - Sender email
 * @param {string} to - Recipient email
 * @param {Object} content - Email content
 * @returns {Promise<Object>} API response
 */
function sendViaSendGrid(apiKey, from, to, content) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject: content.subject,
      content: [
        { type: 'text/plain', value: content.textBody },
        { type: 'text/html', value: content.htmlBody }
      ]
    });

    const options = {
      hostname: 'api.sendgrid.com',
      port: 443,
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        console.log('SendGrid API response:', res.statusCode);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode });
        } else {
          reject(new Error(`SendGrid API error: ${res.statusCode} - ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('SendGrid API request timeout'));
    });

    req.write(data);
    req.end();
  });
}

/**
 * Send a test email (utility function)
 * 
 * @returns {Promise<Object>} API response
 */
async function sendTestEmail() {
  const testData = {
    timestamp: new Date().toISOString(),
    submissionId: 'SSS-20260121-TEST01',
    pfPaymentId: 'TEST-1234567',
    paymentStatus: 'COMPLETE',
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    amountGross: '0.00',
    amountNet: '0.00',
    itemName: 'Landing Page Subscription (Test)',
    token: 'test-token-12345',
    billingDate: '2026-02-21'
  };

  return sendNotificationEmail(testData);
}

module.exports = {
  sendNotificationEmail,
  sendTestEmail
};
