/**
 * Debug Environment Variables (TEMPORARY)
 * 
 * DELETE THIS FILE after debugging!
 * Visit: https://your-site/.netlify/functions/debug-env
 */

exports.handler = async function(event, context) {
  // Only show partial values for security
  const maskValue = (val) => {
    if (!val) return 'NOT SET ❌';
    if (val.length < 10) return `SET ✓ (${val})`;
    return `SET ✓ (${val.substring(0, 4)}...${val.substring(val.length - 4)})`;
  };

  const envStatus = {
    // Database - Check BOTH variable names
    NETLIFY_DATABASE_URL: maskValue(process.env.NETLIFY_DATABASE_URL),
    DATABASE_URL: maskValue(process.env.DATABASE_URL),
    
    // Site URL
    SITE_URL: maskValue(process.env.SITE_URL),
    
    // PayFast
    PAYFAST_MODE: process.env.PAYFAST_MODE || 'NOT SET ❌',
    PAYFAST_SANDBOX_MERCHANT_ID: maskValue(process.env.PAYFAST_SANDBOX_MERCHANT_ID),
    PAYFAST_SANDBOX_MERCHANT_KEY: maskValue(process.env.PAYFAST_SANDBOX_MERCHANT_KEY),
    PAYFAST_SANDBOX_PASSPHRASE: maskValue(process.env.PAYFAST_SANDBOX_PASSPHRASE),
    
    // Email (Resend) - CORRECT VARIABLES
    EMAIL_API_KEY: maskValue(process.env.EMAIL_API_KEY),
    EMAIL_SERVICE: process.env.EMAIL_SERVICE || 'NOT SET ❌',
    NOTIFICATION_EMAIL: maskValue(process.env.NOTIFICATION_EMAIL),
    FROM_EMAIL: maskValue(process.env.FROM_EMAIL),
    
    // reCAPTCHA
    RECAPTCHA_SECRET_KEY: maskValue(process.env.RECAPTCHA_SECRET_KEY),
    
    // Netlify provided
    URL: process.env.URL || 'NOT SET',
    DEPLOY_URL: process.env.DEPLOY_URL || 'NOT SET'
  };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Environment Variable Status',
      warning: 'DELETE debug-env.js after debugging!',
      environment: envStatus
    }, null, 2)
  };
};
