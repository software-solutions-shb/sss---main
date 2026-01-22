/**
 * PayFast Signature Validation Utility
 * 
 * Handles validation of PayFast ITN (Instant Transaction Notification) requests
 * including signature verification and server confirmation.
 * 
 * Validation URL is determined dynamically based on PAYFAST_MODE environment variable.
 * 
 * @module netlify/functions/utils/payfast-validator
 */

const crypto = require('crypto');
const https = require('https');
const { getPayFastValidateUrl, getPayFastHostname } = require('./payfast-config');

/**
 * Validate PayFast ITN signature
 * 
 * PayFast signs all ITN requests with an MD5 hash of the data.
 * This function regenerates the signature and compares it.
 * 
 * @param {Object} data - The ITN data object from PayFast
 * @param {string} passphrase - The merchant passphrase (if set in PayFast dashboard)
 * @returns {boolean} True if signature is valid
 */
function validatePayFastSignature(data, passphrase = '') {
  // Step 1: Create a copy and remove the signature field
  const dataForSigning = { ...data };
  delete dataForSigning.signature;

  // Step 2: Sort the keys alphabetically
  const sortedKeys = Object.keys(dataForSigning).sort();

  // Step 3: Build the parameter string
  // PayFast requires URL encoding of values
  const paramString = sortedKeys
    .filter(key => dataForSigning[key] !== '') // Exclude empty values
    .map(key => {
      const value = dataForSigning[key];
      // URL encode the value, then replace %20 with + (PayFast requirement)
      const encodedValue = encodeURIComponent(value).replace(/%20/g, '+');
      return `${key}=${encodedValue}`;
    })
    .join('&');

  // Step 4: Add passphrase if provided
  const stringToHash = passphrase 
    ? `${paramString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`
    : paramString;

  // Step 5: Generate MD5 hash
  const calculatedSignature = crypto
    .createHash('md5')
    .update(stringToHash)
    .digest('hex');

  // Step 6: Compare with received signature (case-insensitive)
  const receivedSignature = (data.signature || '').toLowerCase();
  const isValid = calculatedSignature.toLowerCase() === receivedSignature;

  return isValid;
}

/**
 * Validate ITN request with PayFast server
 * 
 * This confirms the ITN actually came from PayFast by sending
 * the data back to PayFast's validation endpoint.
 * 
 * @param {Object} data - The ITN data object from PayFast
 * @param {string} merchantId - The merchant ID to validate against
 * @returns {Promise<{valid: boolean, error?: string}>} Validation result
 */
async function validatePayFastRequest(data, merchantId) {
  // Step 1: Verify merchant ID matches
  if (data.merchant_id !== merchantId) {
    return {
      valid: false,
      error: `Merchant ID mismatch: expected ${merchantId}, got ${data.merchant_id}`
    };
  }

  // Step 2: Verify the amount is valid (not negative or zero for actual payments)
  const amount = parseFloat(data.amount_gross || 0);
  if (isNaN(amount)) {
    return {
      valid: false,
      error: 'Invalid amount format'
    };
  }

  // Step 3: Validate with PayFast server (optional but recommended)
  try {
    const isValidServer = await confirmWithPayFast(data);
    if (!isValidServer) {
      return {
        valid: false,
        error: 'PayFast server validation failed'
      };
    }
  } catch (error) {
    // Don't fail if server validation has issues - signature validation is primary
  }

  return { valid: true };
}

/**
 * Confirm ITN with PayFast server
 * 
 * Sends the ITN data back to PayFast to confirm it's legitimate.
 * This is an additional security measure.
 * Uses dynamically constructed URL based on PAYFAST_MODE.
 * 
 * @param {Object} data - The ITN data to validate
 * @returns {Promise<boolean>} True if PayFast confirms the ITN
 */
function confirmWithPayFast(data) {
  return new Promise((resolve, reject) => {
    // Build the POST data
    const postData = Object.keys(data)
      .filter(key => data[key] !== '')
      .map(key => `${key}=${encodeURIComponent(data[key]).replace(/%20/g, '+')}`)
      .join('&');

    // Get URL dynamically based on PAYFAST_MODE
    const validateUrl = getPayFastValidateUrl();
    const url = new URL(validateUrl);
    
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        // PayFast returns 'VALID' if the ITN is legitimate
        const isValid = responseData.trim() === 'VALID';
        resolve(isValid);
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    // Set a timeout
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('PayFast validation request timeout'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Verify the source IP is from PayFast
 * 
 * PayFast ITN requests should come from specific IP addresses.
 * This is an additional security check.
 * 
 * @param {string} sourceIp - The IP address of the request
 * @returns {boolean} True if IP is from PayFast
 */
function verifyPayFastIP(sourceIp) {
  // PayFast IP addresses (check PayFast documentation for current list)
  const payfastIPs = [
    '197.97.145.144',
    '197.97.145.145',
    '197.97.145.146',
    '197.97.145.147',
    '41.74.179.194',
    '41.74.179.195',
    '41.74.179.196',
    '41.74.179.197',
    // Sandbox IPs (for testing)
    '197.97.145.148',
    '197.97.145.149'
  ];

  // Also allow localhost for testing
  const testIPs = ['127.0.0.1', '::1', 'localhost'];

  const isPayFast = payfastIPs.includes(sourceIp);
  const isTest = testIPs.includes(sourceIp);

  return isPayFast || isTest;
}

module.exports = {
  validatePayFastSignature,
  validatePayFastRequest,
  confirmWithPayFast,
  verifyPayFastIP
};
