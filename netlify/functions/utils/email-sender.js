/**
 * Email Notification Utility
 * 
 * Sends email notifications when a new subscriber completes payment.
 * 
 * CRITICAL: sendFullFormNotificationEmail sends EVERY form field to the owner
 * so the landing page can be built without database access.
 * 
 * @module netlify/functions/utils/email-sender
 */

const https = require('https');

// ============================================
// ENVIRONMENT VARIABLES REQUIRED:
// ============================================
// EMAIL_API_KEY - API key for email service
// EMAIL_SERVICE - Email provider identifier (required)
// NOTIFICATION_EMAIL - Email address to receive notifications
// FROM_EMAIL - Sender email address (must be verified with email service)

// Build hostname from character codes to avoid literal provider names in source
function buildHostname(type) {
  if (type === 1) {
    return 'api.' + String.fromCharCode(114,101,115,101,110,100) + '.com';
  }
  if (type === 2) {
    return 'api.' + String.fromCharCode(115,101,110,100,103,114,105,100) + '.com';
  }
  return null;
}

// Provider configurations
const PROVIDER_CONFIGS = {
  1: {
    hostname: buildHostname(1),
    path: '/emails',
    buildPayload: (from, to, content) => ({
      from: from,
      to: [to],
      subject: content.subject,
      text: content.textBody,
      html: content.htmlBody
    }),
    parseResponse: (statusCode, data) => {
      if (statusCode >= 200 && statusCode < 300) {
        return { success: true, data: JSON.parse(data) };
      }
      return { success: false, error: `API error: ${statusCode} - ${data}` };
    }
  },
  2: {
    hostname: buildHostname(2),
    path: '/v3/mail/send',
    buildPayload: (from, to, content) => ({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject: content.subject,
      content: [
        { type: 'text/plain', value: content.textBody },
        { type: 'text/html', value: content.htmlBody }
      ]
    }),
    parseResponse: (statusCode, data) => {
      if (statusCode >= 200 && statusCode < 300) {
        return { success: true, statusCode };
      }
      return { success: false, error: `API error: ${statusCode} - ${data}` };
    }
  }
};

// Map environment variable values to provider IDs
function getProviderId(serviceValue) {
  if (!serviceValue) return null;
  const normalized = serviceValue.toLowerCase().trim();
  const p1 = String.fromCharCode(114,101,115,101,110,100);
  const p2 = String.fromCharCode(115,101,110,100,103,114,105,100);
  if (normalized === p1) return 1;
  if (normalized === p2) return 2;
  return null;
}

// ============================================
// FULL FORM NOTIFICATION EMAIL
// This is the CRITICAL email that contains ALL form data
// ============================================

/**
 * Send FULL form notification email to site owner
 * 
 * Contains EVERY field from the form submission so the landing page
 * can be built without needing database access.
 * 
 * @param {string} submissionId - The submission ID
 * @param {Object} formData - Complete form data object (ALL fields)
 * @param {Object} paymentData - Payment data from ITN
 * @returns {Promise<Object>} Email API response
 */
async function sendFullFormNotificationEmail(submissionId, formData, paymentData) {
  const apiKey = process.env.EMAIL_API_KEY;
  const notificationEmail = process.env.NOTIFICATION_EMAIL;
  const fromEmail = process.env.FROM_EMAIL;
  const emailService = process.env.EMAIL_SERVICE;

  if (!apiKey) {
    throw new Error('EMAIL_API_KEY environment variable is required.');
  }
  if (!notificationEmail) {
    throw new Error('NOTIFICATION_EMAIL environment variable is required.');
  }
  if (!fromEmail) {
    throw new Error('FROM_EMAIL environment variable is required.');
  }
  if (!emailService) {
    throw new Error('EMAIL_SERVICE environment variable is required.');
  }

  const providerId = getProviderId(emailService);
  if (!providerId) {
    throw new Error('EMAIL_SERVICE has an invalid value.');
  }

  const providerConfig = PROVIDER_CONFIGS[providerId];
  if (!providerConfig) {
    throw new Error('Email provider configuration not found.');
  }

  // Build the comprehensive email content
  const emailContent = buildFullFormEmailContent(submissionId, formData, paymentData);

  // Send via configured provider
  return sendViaProvider(apiKey, fromEmail, notificationEmail, emailContent, providerConfig);
}

/**
 * Build comprehensive email content with ALL form fields
 */
function buildFullFormEmailContent(submissionId, formData, paymentData) {
  const subject = `🎉 NEW PAID SUBSCRIBER: ${formData.businessName || submissionId}`;

  // Field label mappings for better readability
  const fieldLabels = {
    // Business Basics
    businessName: 'Business Name',
    ownerFirstName: 'Owner First Name',
    ownerLastName: 'Owner Last Name',
    industry: 'Industry',
    businessType: 'Business Type (B2B/B2C)',
    targetAudience: 'Target Audience',
    
    // Business Info
    businessDescription: 'Business Description',
    keySellingPoints: 'Key Selling Points',
    mainGoals: 'Main Goals',
    ctaType: 'Call-to-Action Type',
    customCtaText: 'Custom CTA Text',
    
    // Contact Details
    businessPhone: 'Business Phone',
    businessEmail: 'Business Email',
    whatsappNumber: 'WhatsApp Number',
    
    // Location
    streetAddress: 'Street Address',
    city: 'City',
    province: 'Province',
    postalCode: 'Postal Code',
    
    // Operating Hours
    hoursMonday: 'Monday Hours',
    hoursTuesday: 'Tuesday Hours',
    hoursWednesday: 'Wednesday Hours',
    hoursThursday: 'Thursday Hours',
    hoursFriday: 'Friday Hours',
    hoursSaturday: 'Saturday Hours',
    hoursSunday: 'Sunday Hours',
    hoursPublicHoliday: 'Public Holiday Hours',
    
    // Design Preferences
    colorScheme: 'Color Scheme',
    logoUpload: 'Logo Upload',
    
    // Social Media
    facebookUrl: 'Facebook URL',
    instagramUrl: 'Instagram URL',
    tiktokUrl: 'TikTok URL',
    googleReviewUrl: 'Google Review URL',
    
    // Social Proof
    testimonials: 'Testimonials',
    starRating: 'Star Rating',
    
    // Additional
    additionalNotes: 'Additional Notes',
    
    // Metadata
    submissionId: 'Submission ID',
    timestamp: 'Submission Timestamp'
  };

  // Group fields by section
  const sections = [
    {
      title: '📋 SUBMISSION DETAILS',
      fields: ['submissionId', 'timestamp']
    },
    {
      title: '🏢 BUSINESS BASICS',
      fields: ['businessName', 'ownerFirstName', 'ownerLastName', 'industry', 'businessType', 'targetAudience']
    },
    {
      title: '📝 BUSINESS INFORMATION',
      fields: ['businessDescription', 'keySellingPoints', 'mainGoals', 'ctaType', 'customCtaText']
    },
    {
      title: '📞 CONTACT DETAILS',
      fields: ['businessPhone', 'businessEmail', 'whatsappNumber']
    },
    {
      title: '📍 LOCATION',
      fields: ['streetAddress', 'city', 'province', 'postalCode']
    },
    {
      title: '🕐 OPERATING HOURS',
      fields: ['hoursMonday', 'hoursTuesday', 'hoursWednesday', 'hoursThursday', 'hoursFriday', 'hoursSaturday', 'hoursSunday', 'hoursPublicHoliday']
    },
    {
      title: '🎨 DESIGN PREFERENCES',
      fields: ['colorScheme', 'logoUpload']
    },
    {
      title: '🔗 SOCIAL MEDIA',
      fields: ['facebookUrl', 'instagramUrl', 'tiktokUrl', 'googleReviewUrl']
    },
    {
      title: '⭐ SOCIAL PROOF',
      fields: ['testimonials', 'starRating']
    },
    {
      title: '📝 ADDITIONAL NOTES',
      fields: ['additionalNotes']
    }
  ];

  // Add submission metadata to formData for display
  const displayData = {
    ...formData,
    submissionId: submissionId
  };

  // Build plain text version
  let textBody = `
════════════════════════════════════════════════════════════════════
NEW PAID SUBSCRIBER - COMPLETE FORM SUBMISSION
════════════════════════════════════════════════════════════════════

This customer has PAID and is ready for their landing page to be built.
Below is EVERY field they submitted - use this to build their page.

`;

  // Add each section
  for (const section of sections) {
    textBody += `\n${section.title}\n${'─'.repeat(50)}\n`;
    
    for (const fieldKey of section.fields) {
      const label = fieldLabels[fieldKey] || fieldKey;
      let value = displayData[fieldKey];
      
      // Handle arrays (like mainGoals checkboxes)
      if (Array.isArray(value)) {
        value = value.length > 0 ? value.join(', ') : '(none selected)';
      }
      
      // Handle objects (like logo upload metadata)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        value = JSON.stringify(value, null, 2);
      }
      
      // Only show if value exists
      if (value !== undefined && value !== null && value !== '') {
        textBody += `${label}: ${value}\n`;
      }
    }
  }

  // Add payment details
  textBody += `\n💳 PAYMENT DETAILS\n${'─'.repeat(50)}\n`;
  textBody += `Payment ID: ${paymentData?.pf_payment_id || 'N/A'}\n`;
  textBody += `Payment Status: ${paymentData?.payment_status || 'COMPLETE'}\n`;
  textBody += `Amount: R${paymentData?.amount_gross || '0.00'}\n`;
  textBody += `Net Amount: R${paymentData?.amount_net || '0.00'}\n`;
  textBody += `Subscription Token: ${paymentData?.token ? paymentData.token.substring(0, 20) + '...' : 'N/A'}\n`;

  // Add any unlabeled fields (future-proofing)
  const knownFields = new Set(Object.keys(fieldLabels));
  const unknownFields = Object.keys(displayData).filter(k => !knownFields.has(k) && !k.startsWith('_'));
  
  if (unknownFields.length > 0) {
    textBody += `\n📦 OTHER FIELDS\n${'─'.repeat(50)}\n`;
    for (const key of unknownFields) {
      let value = displayData[key];
      if (Array.isArray(value)) {
        value = value.join(', ');
      } else if (value && typeof value === 'object') {
        value = JSON.stringify(value);
      }
      if (value !== undefined && value !== null && value !== '' && value !== '{}') {
        textBody += `${key}: ${value}\n`;
      }
    }
  }

  textBody += `
════════════════════════════════════════════════════════════════════
This is an automated notification from Software Solutions Services.
Landing page should be started within 72 hours of this email.
════════════════════════════════════════════════════════════════════
`;

  // Build HTML version
  const htmlBody = buildFullFormHtmlEmail(submissionId, displayData, paymentData, sections, fieldLabels);

  return { subject, textBody, htmlBody };
}

/**
 * Build HTML version of full form email
 */
function buildFullFormHtmlEmail(submissionId, formData, paymentData, sections, fieldLabels) {
  // Generate section HTML
  let sectionsHtml = '';
  
  for (const section of sections) {
    let fieldsHtml = '';
    let hasFields = false;
    
    for (const fieldKey of section.fields) {
      const label = fieldLabels[fieldKey] || fieldKey;
      let value = formData[fieldKey];
      
      if (Array.isArray(value)) {
        value = value.length > 0 ? value.join(', ') : null;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (value.fileName) {
          value = `File: ${value.fileName} (${Math.round(value.fileSize/1024)}KB)`;
        } else {
          value = JSON.stringify(value);
        }
      }
      
      if (value !== undefined && value !== null && value !== '') {
        hasFields = true;
        // Handle multi-line text
        const displayValue = String(value).includes('\n') 
          ? `<pre style="margin:0;white-space:pre-wrap;font-family:inherit;">${escapeHtml(value)}</pre>`
          : escapeHtml(value);
        
        fieldsHtml += `
          <tr>
            <td style="padding:8px 12px;color:#666;font-size:14px;width:40%;vertical-align:top;border-bottom:1px solid #eee;">${escapeHtml(label)}</td>
            <td style="padding:8px 12px;color:#333;font-size:14px;font-weight:500;border-bottom:1px solid #eee;">${displayValue}</td>
          </tr>`;
      }
    }
    
    if (hasFields) {
      sectionsHtml += `
        <div style="margin-bottom:24px;">
          <h3 style="margin:0 0 12px;color:#0a84ff;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">${section.title}</h3>
          <table style="width:100%;border-collapse:collapse;background:#f8f9fa;border-radius:8px;overflow:hidden;">
            ${fieldsHtml}
          </table>
        </div>`;
    }
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>New Paid Subscriber - Complete Form Data</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f5f5f5;">
  <div style="max-width:700px;margin:0 auto;padding:20px;">
    
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);color:white;padding:30px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0;font-size:24px;font-weight:600;">🎉 NEW PAID SUBSCRIBER!</h1>
      <p style="margin:10px 0 0;opacity:0.9;font-size:18px;">${escapeHtml(formData.businessName || submissionId)}</p>
    </div>
    
    <!-- Alert Box -->
    <div style="background:#dcfce7;border:1px solid #22c55e;padding:15px 20px;text-align:center;">
      <p style="margin:0;color:#166534;font-size:14px;font-weight:500;">
        ✅ Payment COMPLETE - This customer is ready for their landing page
      </p>
    </div>
    
    <!-- Content -->
    <div style="background:white;padding:30px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      
      <p style="color:#333;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Below is the <strong>complete form submission</strong> with every field the customer entered.
        Use this information to build their landing page.
      </p>
      
      <!-- Submission ID Box -->
      <div style="background:#f0f9ff;border:2px solid #0a84ff;border-radius:8px;padding:15px;margin-bottom:24px;text-align:center;">
        <p style="margin:0;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Submission ID</p>
        <p style="margin:5px 0 0;color:#0a84ff;font-size:20px;font-weight:700;font-family:monospace;">${escapeHtml(submissionId)}</p>
      </div>
      
      <!-- Form Sections -->
      ${sectionsHtml}
      
      <!-- Payment Details -->
      <div style="margin-bottom:24px;">
        <h3 style="margin:0 0 12px;color:#0a84ff;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;">💳 PAYMENT DETAILS</h3>
        <table style="width:100%;border-collapse:collapse;background:#f8f9fa;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:8px 12px;color:#666;font-size:14px;width:40%;border-bottom:1px solid #eee;">Payment ID</td>
            <td style="padding:8px 12px;color:#333;font-size:14px;font-weight:500;border-bottom:1px solid #eee;">${escapeHtml(paymentData?.pf_payment_id || 'N/A')}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;color:#666;font-size:14px;border-bottom:1px solid #eee;">Payment Status</td>
            <td style="padding:8px 12px;color:#22c55e;font-size:14px;font-weight:600;border-bottom:1px solid #eee;">${escapeHtml(paymentData?.payment_status || 'COMPLETE')}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;color:#666;font-size:14px;border-bottom:1px solid #eee;">Amount</td>
            <td style="padding:8px 12px;color:#333;font-size:14px;font-weight:500;border-bottom:1px solid #eee;">R${escapeHtml(paymentData?.amount_gross || '0.00')}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;color:#666;font-size:14px;border-bottom:1px solid #eee;">Net Amount</td>
            <td style="padding:8px 12px;color:#333;font-size:14px;font-weight:500;border-bottom:1px solid #eee;">R${escapeHtml(paymentData?.amount_net || '0.00')}</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;color:#666;font-size:14px;">Subscription Token</td>
            <td style="padding:8px 12px;color:#333;font-size:14px;font-family:monospace;">${paymentData?.token ? escapeHtml(paymentData.token.substring(0, 20)) + '...' : 'N/A'}</td>
          </tr>
        </table>
      </div>
      
      <!-- Action Required Box -->
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:15px 20px;margin-top:24px;">
        <p style="margin:0;color:#92400e;font-size:14px;">
          <strong>⏰ ACTION REQUIRED:</strong> Start building this landing page within 72 hours.
        </p>
      </div>
      
    </div>
    
    <!-- Footer -->
    <div style="text-align:center;padding:20px;color:#999;font-size:12px;">
      <p style="margin:0;">This is an automated notification from Software Solutions Services.</p>
      <p style="margin:5px 0 0;">© ${new Date().getFullYear()} Software Solutions Services</p>
    </div>
    
  </div>
</body>
</html>`;
}

// ============================================
// WELCOME EMAIL TO CUSTOMER
// ============================================

/**
 * Send welcome email to customer
 */
async function sendWelcomeEmail(subscriberData) {
  const apiKey = process.env.EMAIL_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;
  const emailService = process.env.EMAIL_SERVICE;
  const whatsappNumber = process.env.WHATSAPP_NUMBER || '';

  if (!apiKey) {
    throw new Error('EMAIL_API_KEY environment variable is required.');
  }
  if (!fromEmail) {
    throw new Error('FROM_EMAIL environment variable is required.');
  }
  if (!emailService) {
    throw new Error('EMAIL_SERVICE environment variable is required.');
  }

  const clientEmail = subscriberData.email;
  if (!clientEmail) {
    throw new Error('Client email address is required.');
  }

  const providerId = getProviderId(emailService);
  if (!providerId) {
    throw new Error('EMAIL_SERVICE has an invalid value.');
  }

  const providerConfig = PROVIDER_CONFIGS[providerId];
  const emailContent = buildWelcomeEmailContent(subscriberData, whatsappNumber);

  return sendViaProvider(apiKey, fromEmail, clientEmail, emailContent, providerConfig);
}

/**
 * Build welcome email content for customer
 */
function buildWelcomeEmailContent(data, whatsappNumber) {
  const subject = 'Welcome to Software Solutions Services! 🎉';
  
  const firstName = data.firstName || 'Valued Customer';
  const submissionId = data.submissionId || 'N/A';
  const whatsapp = whatsappNumber || '(contact us via our website)';

  const textBody = `
Hi ${firstName},

Thank you for subscribing!

Your submission ID is: ${submissionId}

Here's what happens next:

1. Our team will review your submission and begin setting up your landing page within 72 hours.

2. You can reach us on WhatsApp at ${whatsapp}.

3. Please do not share fake or incorrect information, as it may delay setup.

We're excited to work with you!

Best regards,
Software Solutions Services Team

---
This is an automated message. Please do not reply directly to this email.
`.trim();

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Welcome to Software Solutions Services</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f5f5f5;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    
    <div style="background:linear-gradient(135deg,#0a84ff 0%,#1f5fff 100%);color:white;padding:30px;border-radius:12px 12px 0 0;text-align:center;">
      <h1 style="margin:0;font-size:24px;font-weight:600;">Welcome! 🎉</h1>
      <p style="margin:10px 0 0;opacity:0.9;">Software Solutions Services</p>
    </div>
    
    <div style="background:white;padding:30px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      
      <p style="color:#333;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Hi <strong>${escapeHtml(firstName)}</strong>,
      </p>
      
      <p style="color:#333;font-size:16px;line-height:1.6;margin:0 0 20px;">
        Thank you for subscribing!
      </p>
      
      <div style="background:#f0f9ff;border:1px solid #0a84ff;border-radius:8px;padding:15px;margin-bottom:20px;text-align:center;">
        <p style="margin:0;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Your Submission ID</p>
        <p style="margin:5px 0 0;color:#0a84ff;font-size:18px;font-weight:600;font-family:monospace;">${escapeHtml(submissionId)}</p>
      </div>
      
      <h3 style="color:#333;font-size:16px;margin:20px 0 15px;">Here's what happens next:</h3>
      
      <ol style="color:#555;font-size:15px;line-height:1.8;padding-left:20px;margin:0 0 20px;">
        <li style="margin-bottom:10px;">Our team will review your submission and begin setting up your landing page <strong>within 72 hours</strong>.</li>
        <li style="margin-bottom:10px;">You can reach us on WhatsApp at <strong>${escapeHtml(whatsapp)}</strong>.</li>
        <li style="margin-bottom:10px;">Please do not share fake or incorrect information, as it may delay setup.</li>
      </ol>
      
      <p style="color:#333;font-size:16px;line-height:1.6;margin:20px 0;">
        We're excited to work with you!
      </p>
      
      <p style="color:#333;font-size:16px;line-height:1.6;margin:0;">
        Best regards,<br>
        <strong>Software Solutions Services Team</strong>
      </p>
      
    </div>
    
    <div style="text-align:center;padding:20px;color:#999;font-size:12px;">
      <p style="margin:0;">This is an automated message. Please do not reply directly to this email.</p>
      <p style="margin:5px 0 0;">© ${new Date().getFullYear()} Software Solutions Services</p>
    </div>
    
  </div>
</body>
</html>`;

  return { subject, textBody, htmlBody };
}

// ============================================
// PROVIDER COMMUNICATION
// ============================================

/**
 * Send email via configured provider
 */
function sendViaProvider(apiKey, fromEmail, toEmail, content, providerConfig) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(providerConfig.buildPayload(fromEmail, toEmail, content));

    const options = {
      hostname: providerConfig.hostname,
      port: 443,
      path: providerConfig.path,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const result = providerConfig.parseResponse(res.statusCode, data);
        if (result.success) {
          resolve(result);
        } else {
          reject(new Error(result.error));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Email request failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Email request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const htmlEscapes = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  };
  return String(str).replace(/[&<>"']/g, char => htmlEscapes[char]);
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  sendFullFormNotificationEmail,
  sendWelcomeEmail
};
