/**
 * reCAPTCHA Validation Utility
 * 
 * Server-side validation of Google reCAPTCHA v3 tokens.
 * v3 returns a score (0.0 - 1.0) indicating likelihood of human interaction.
 * 
 * ENVIRONMENT VARIABLES REQUIRED:
 *   RECAPTCHA_SECRET_KEY - Your reCAPTCHA v3 secret key from Google
 * 
 * @module netlify/functions/utils/recaptcha
 */

const https = require('https');

// Minimum score to consider valid (0.0 = bot, 1.0 = definitely human)
// 0.5 is Google's recommended threshold
const MIN_SCORE = 0.5;

/**
 * Verify a reCAPTCHA v3 token with Google's API
 * 
 * @param {string} token - The reCAPTCHA token from the client
 * @param {string} expectedAction - The action name to verify (e.g., 'submit_form')
 * @param {string} remoteIp - Optional: The user's IP address
 * @returns {Promise<{success: boolean, score?: number, error?: string}>}
 */
async function verifyRecaptcha(token, expectedAction = 'submit_form', remoteIp = null) {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  
  if (!secretKey) {
    console.warn('[reCAPTCHA] RECAPTCHA_SECRET_KEY not set, skipping validation');
    // Return success if not configured (allows testing without reCAPTCHA)
    return { success: true, skipped: true };
  }
  
  if (!token) {
    return { success: false, error: 'No reCAPTCHA token provided' };
  }
  
  return new Promise((resolve) => {
    // Build POST data
    const postData = new URLSearchParams({
      secret: secretKey,
      response: token
    });
    
    if (remoteIp) {
      postData.append('remoteip', remoteIp);
    }
    
    const postString = postData.toString();
    
    const options = {
      hostname: 'www.google.com',
      port: 443,
      path: '/recaptcha/api/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postString)
      },
      timeout: 10000
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          console.log('[reCAPTCHA v3] Response:', {
            success: result.success,
            score: result.score,
            action: result.action,
            hostname: result.hostname
          });
          
          // v3 returns success + score
          if (!result.success) {
            console.log('[reCAPTCHA] Verification failed:', result['error-codes']);
            resolve({ 
              success: false, 
              error: 'reCAPTCHA verification failed',
              codes: result['error-codes']
            });
            return;
          }
          
          // Check the score (0.0 = bot, 1.0 = human)
          const score = result.score || 0;
          if (score < MIN_SCORE) {
            console.log(`[reCAPTCHA] Score too low: ${score} < ${MIN_SCORE}`);
            resolve({ 
              success: false, 
              score: score,
              error: `reCAPTCHA score too low (${score})`
            });
            return;
          }
          
          // Optionally verify the action matches
          if (expectedAction && result.action !== expectedAction) {
            console.warn(`[reCAPTCHA] Action mismatch: expected "${expectedAction}", got "${result.action}"`);
            // Don't fail on action mismatch, just log it
          }
          
          console.log(`[reCAPTCHA] Verification successful (score: ${score})`);
          resolve({ success: true, score: score });
          
        } catch (parseError) {
          console.error('[reCAPTCHA] Failed to parse response:', parseError.message);
          resolve({ success: false, error: 'Failed to verify reCAPTCHA' });
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('[reCAPTCHA] Request error:', error.message);
      // On network error, fail closed (deny access)
      resolve({ success: false, error: 'reCAPTCHA service unavailable' });
    });
    
    req.on('timeout', () => {
      req.destroy();
      console.error('[reCAPTCHA] Request timeout');
      resolve({ success: false, error: 'reCAPTCHA verification timeout' });
    });
    
    req.write(postString);
    req.end();
  });
}

module.exports = {
  verifyRecaptcha
};
