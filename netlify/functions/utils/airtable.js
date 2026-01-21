/**
 * Airtable Integration Utility
 * 
 * Handles appending subscriber data to an Airtable base acting as a
 * lightweight database for subscription records.
 * 
 * Uses Airtable REST API for serverless environments.
 * 
 * @module netlify/functions/utils/airtable
 */

const https = require('https');

// ============================================
// ENVIRONMENT VARIABLES REQUIRED:
// ============================================
// AIRTABLE_API_KEY - Airtable Personal Access Token
// AIRTABLE_BASE_ID - The ID of the target Airtable base (starts with 'app')
// AIRTABLE_TABLE_NAME - The name of the table to append records to

/**
 * Append subscriber data to Airtable
 * 
 * @param {Object} subscriberData - The subscriber data to append
 * @returns {Promise<Object>} Airtable API response
 */
async function appendToAirtable(subscriberData) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  if (!apiKey) {
    throw new Error('AIRTABLE_API_KEY environment variable is required but not set.');
  }

  if (!baseId) {
    throw new Error('AIRTABLE_BASE_ID environment variable is required but not set.');
  }

  if (!tableName) {
    throw new Error('AIRTABLE_TABLE_NAME environment variable is required but not set.');
  }

  console.log('Appending data to Airtable...');
  console.log('Base ID:', baseId);
  console.log('Table:', tableName);

  // Map subscriber data to Airtable fields
  const fields = mapToAirtableFields(subscriberData);

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      records: [
        {
          fields: fields
        }
      ]
    });

    // URL encode the table name for the API path
    const encodedTableName = encodeURIComponent(tableName);

    const options = {
      hostname: 'api.airtable.com',
      port: 443,
      path: `/v0/${baseId}/${encodedTableName}`,
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
        console.log('Airtable API response status:', res.statusCode);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(responseData);
            console.log('✓ Successfully appended record to Airtable');
            console.log('Record ID:', parsed.records?.[0]?.id);
            resolve(parsed);
          } catch (e) {
            resolve({ success: true, statusCode: res.statusCode });
          }
        } else {
          console.error('Airtable API error:', responseData);
          reject(new Error(`Airtable API error: ${res.statusCode} - ${responseData}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('Airtable request error:', error);
      reject(error);
    });

    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Airtable API request timeout'));
    });

    req.write(data);
    req.end();
  });
}

/**
 * Map subscriber data to Airtable field names
 * 
 * Airtable fields should be created in the base with these exact names.
 * Field types:
 * - Timestamp: Date/Time
 * - Submission ID: Single line text
 * - Payment ID: Single line text
 * - Payment Status: Single select
 * - First Name: Single line text
 * - Last Name: Single line text
 * - Email: Email
 * - Amount Gross: Currency
 * - Amount Net: Currency
 * - Item Name: Single line text
 * - Subscription Token: Single line text
 * - Billing Date: Date
 * - Business Name: Single line text
 * - Custom Data: Long text
 * 
 * @param {Object} data - Raw subscriber data
 * @returns {Object} Mapped Airtable fields
 */
function mapToAirtableFields(data) {
  return {
    'Timestamp': data.timestamp || new Date().toISOString(),
    'Submission ID': data.submissionId || '',
    'Payment ID': data.pfPaymentId || '',
    'Payment Status': data.paymentStatus || '',
    'First Name': data.firstName || '',
    'Last Name': data.lastName || '',
    'Email': data.email || '',
    'Amount Gross': parseFloat(data.amountGross) || 0,
    'Amount Net': parseFloat(data.amountNet) || 0,
    'Item Name': data.itemName || '',
    'Subscription Token': data.token || '',
    'Billing Date': data.billingDate || '',
    'Business Name': data.customStr2 || '',
    'Custom Data': data.customStr3 || ''
  };
}

/**
 * Find a record by Submission ID
 * 
 * @param {string} submissionId - The submission ID to search for
 * @returns {Promise<Object|null>} The found record or null
 */
async function findBySubmissionId(submissionId) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  if (!apiKey) {
    throw new Error('AIRTABLE_API_KEY environment variable is required but not set.');
  }
  if (!baseId) {
    throw new Error('AIRTABLE_BASE_ID environment variable is required but not set.');
  }
  if (!tableName) {
    throw new Error('AIRTABLE_TABLE_NAME environment variable is required but not set.');
  }

  return new Promise((resolve, reject) => {
    const encodedTableName = encodeURIComponent(tableName);
    const filterFormula = encodeURIComponent(`{Submission ID}="${submissionId}"`);

    const options = {
      hostname: 'api.airtable.com',
      port: 443,
      path: `/v0/${baseId}/${encodedTableName}?filterByFormula=${filterFormula}&maxRecords=1`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    };

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(responseData);
            const record = parsed.records?.[0] || null;
            resolve(record);
          } catch (e) {
            resolve(null);
          }
        } else {
          reject(new Error(`Airtable API error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Airtable API request timeout'));
    });

    req.end();
  });
}

/**
 * Update a record by ID
 * 
 * @param {string} recordId - The Airtable record ID
 * @param {Object} fields - The fields to update
 * @returns {Promise<Object>} Updated record
 */
async function updateRecord(recordId, fields) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  if (!apiKey) {
    throw new Error('AIRTABLE_API_KEY environment variable is required but not set.');
  }
  if (!baseId) {
    throw new Error('AIRTABLE_BASE_ID environment variable is required but not set.');
  }
  if (!tableName) {
    throw new Error('AIRTABLE_TABLE_NAME environment variable is required but not set.');
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ fields });
    const encodedTableName = encodeURIComponent(tableName);

    const options = {
      hostname: 'api.airtable.com',
      port: 443,
      path: `/v0/${baseId}/${encodedTableName}/${recordId}`,
      method: 'PATCH',
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
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseData));
        } else {
          reject(new Error(`Airtable API error: ${res.statusCode} - ${responseData}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Airtable API request timeout'));
    });

    req.write(data);
    req.end();
  });
}

module.exports = {
  appendToAirtable,
  findBySubmissionId,
  updateRecord
};
