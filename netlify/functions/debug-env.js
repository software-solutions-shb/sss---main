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
    if (val.length < 10) return 'SET ✓ (short value)';
    return `SET ✓ (${val.substring(0, 4)}...${val.substring(val.length - 4)})`;
  };

  const envStatus = {
    // Database
    DATABASE_URL: maskValue(process.env.DATABASE_URL),
    
    // Site URL
    SITE_URL: maskValue(process.env.SITE_URL),
    
    // PayFast
    PAYFAST_MODE: process.env.PAYFAST_MODE || 'NOT SET ❌',
    PAYFAST_SANDBOX_MERCHANT_ID: maskValue(process.env.PAYFAST_SANDBOX_MERCHANT_ID),
    PAYFAST_SANDBOX_MERCHANT_KEY: maskValue(process.env.PAYFAST_SANDBOX_MERCHANT_KEY),
    PAYFAST_SANDBOX_PASSPHRASE: maskValue(process.env.PAYFAST_SANDBOX_PASSPHRASE),
    
    // reCAPTCHA
    RECAPTCHA_SECRET_KEY: maskValue(process.env.RECAPTCHA_SECRET_KEY),
    
    // Email
    EMAIL_HOST: maskValue(process.env.EMAIL_HOST),
    EMAIL_USER: maskValue(process.env.EMAIL_USER),
    EMAIL_PASS: maskValue(process.env.EMAIL_PASS),
    
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
