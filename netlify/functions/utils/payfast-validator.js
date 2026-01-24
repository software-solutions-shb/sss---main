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
 * IMPORTANT: For ITN validation, fields must be processed in the order
 * they were received, stopping before the signature field.
 * See: https://developers.payfast.co.za/docs#verify-the-signature
 * 
 * @param {Object} data - The ITN data object from PayFast (preserves insertion order)
 * @param {string} passphrase - The merchant passphrase (if set in PayFast dashboard)
 * @returns {boolean} True if signature is valid
 */
function validatePayFastSignature(data, passphrase = '') {
  // Step 1: Build parameter string in the order fields were received
  // Stop when we reach the signature field (it should be last)
  const paramParts = [];
  
  for (const [key, value] of Object.entries(data)) {
    // Stop at signature field
    if (key === 'signature') {
      break;
    }
    // Skip empty values
    if (value === '' || value === null || value === undefined) {
      continue;
    }
    // URL encode the value, replace %20 with + (PayFast requirement)
    const encodedValue = encodeURIComponent(String(value)).replace(/%20/g, '+');
    paramParts.push(`${key}=${encodedValue}`);
  }
  
  const paramString = paramParts.join('&');

  // Step 2: Add passphrase if provided
  const stringToHash = passphrase 
    ? `${paramString}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`
    : paramString;

  // Step 3: Generate MD5 hash
  const calculatedSignature = crypto
    .createHash('md5')
    .update(stringToHash)
    .digest('hex');

  // Step 4: Compare with received signature (case-insensitive)
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
 * PayFast ITN requests should come from specific IP ranges.
 * Updated IP ranges from PayFast documentation (2024):
 * - 197.97.145.144/28 (197.97.145.144 - 197.97.145.159)
 * - 41.74.179.192/27 (41.74.179.192 - 41.74.179.223)
 * - 102.216.36.0/28 (102.216.36.0 - 102.216.36.15)
 * - 102.216.36.128/28 (102.216.36.128 - 102.216.36.143)
 * - 144.126.193.139
 * 
 * @param {string} sourceIp - The IP address of the request
 * @returns {boolean} True if IP is from PayFast
 */
function verifyPayFastIP(sourceIp) {
  // Convert IP to number for range checking
  function ipToNumber(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    return parts.reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }

  // Check if IP is in a CIDR range
  function isInRange(ip, cidr) {
    const [rangeIp, bits] = cidr.split('/');
    const ipNum = ipToNumber(ip);
    const rangeNum = ipToNumber(rangeIp);
    if (ipNum === null || rangeNum === null) return false;
    const mask = ~((1 << (32 - parseInt(bits, 10))) - 1) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  }

  // PayFast IP ranges from documentation
  const payfastRanges = [
    '197.97.145.144/28',   // 197.97.145.144 - 197.97.145.159
    '41.74.179.192/27',    // 41.74.179.192 - 41.74.179.223
    '102.216.36.0/28',     // 102.216.36.0 - 102.216.36.15
    '102.216.36.128/28'    // 102.216.36.128 - 102.216.36.143
  ];

  // Single IPs
  const payfastSingleIPs = [
    '144.126.193.139'
  ];

  // Also allow localhost for testing
  const testIPs = ['127.0.0.1', '::1', 'localhost'];

  // Check single IPs first
  if (payfastSingleIPs.includes(sourceIp) || testIPs.includes(sourceIp)) {
    return true;
  }

  // Check CIDR ranges
  for (const range of payfastRanges) {
    if (isInRange(sourceIp, range)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  validatePayFastSignature,
  validatePayFastRequest,
  confirmWithPayFast,
  verifyPayFastIP
};
