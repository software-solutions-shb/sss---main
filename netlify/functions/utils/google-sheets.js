/**
 * Google Sheets Integration Utility
 * 
 * Handles appending subscriber data to a Google Sheet acting as a
 * lightweight database for subscription records.
 * 
 * Uses Google Service Account authentication for serverless environments.
 * 
 * @module netlify/functions/utils/google-sheets
 */

const { google } = require('googleapis');

// ============================================
// ENVIRONMENT VARIABLES REQUIRED:
// ============================================
// GOOGLE_SERVICE_ACCOUNT_EMAIL - Service account email (xxx@xxx.iam.gserviceaccount.com)
// GOOGLE_PRIVATE_KEY - Service account private key (with \n for newlines)
// GOOGLE_SHEET_ID - The ID of the target Google Sheet

/**
 * Get authenticated Google Sheets client
 * 
 * Creates a JWT client using service account credentials from environment variables.
 * 
 * @returns {Promise<Object>} Authenticated Google Sheets API client
 */
async function getGoogleSheetsClient() {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!serviceAccountEmail || !privateKey) {
    throw new Error('Google Sheets credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.');
  }

  // Create JWT auth client
  // Note: Private key needs newlines restored (Netlify escapes them)
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  // Authorize and return sheets client
  await auth.authorize();
  
  return google.sheets({ version: 'v4', auth });
}

/**
 * Append subscriber data to Google Sheet
 * 
 * Adds a new row to the configured Google Sheet with subscription details.
 * The sheet should have the following columns (in order):
 * A: Timestamp
 * B: Submission ID
 * C: Payment ID
 * D: Payment Status
 * E: First Name
 * F: Last Name
 * G: Email
 * H: Amount Gross
 * I: Amount Net
 * J: Item Name
 * K: Subscription Token
 * L: Billing Date
 * M: Custom Data 2
 * N: Custom Data 3
 * 
 * @param {Object} subscriberData - The subscriber data to append
 * @returns {Promise<Object>} Google Sheets API response
 */
async function appendToGoogleSheet(subscriberData) {
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!sheetId) {
    throw new Error('Google Sheet ID not configured. Set GOOGLE_SHEET_ID environment variable.');
  }

  console.log('Appending to Google Sheet:', sheetId);

  try {
    const sheets = await getGoogleSheetsClient();

    // Prepare row data
    // Order must match the sheet columns
    const rowData = [
      subscriberData.timestamp || new Date().toISOString(),
      subscriberData.submissionId || '',
      subscriberData.pfPaymentId || '',
      subscriberData.paymentStatus || '',
      subscriberData.firstName || '',
      subscriberData.lastName || '',
      subscriberData.email || '',
      subscriberData.amountGross || '',
      subscriberData.amountNet || '',
      subscriberData.itemName || '',
      subscriberData.token || '',
      subscriberData.billingDate || '',
      subscriberData.customStr2 || '',
      subscriberData.customStr3 || ''
    ];

    console.log('Row data:', rowData);

    // Append to sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A:N', // Adjust range based on your sheet
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [rowData]
      }
    });

    console.log('Google Sheets append response:', {
      updatedRange: response.data.updates?.updatedRange,
      updatedRows: response.data.updates?.updatedRows
    });

    return response.data;

  } catch (error) {
    console.error('Google Sheets error:', error.message);
    
    // Provide helpful error messages
    if (error.message.includes('not found')) {
      throw new Error(`Google Sheet not found. Verify GOOGLE_SHEET_ID is correct and the service account has access.`);
    }
    if (error.message.includes('permission')) {
      throw new Error(`Permission denied. Share the Google Sheet with the service account email.`);
    }
    
    throw error;
  }
}

/**
 * Create headers row in Google Sheet (utility function)
 * 
 * Call this once to set up column headers in a new sheet.
 * 
 * @returns {Promise<Object>} Google Sheets API response
 */
async function createSheetHeaders() {
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!sheetId) {
    throw new Error('Google Sheet ID not configured.');
  }

  const sheets = await getGoogleSheetsClient();

  const headers = [
    'Timestamp',
    'Submission ID',
    'Payment ID',
    'Payment Status',
    'First Name',
    'Last Name',
    'Email',
    'Amount Gross',
    'Amount Net',
    'Item Name',
    'Subscription Token',
    'Billing Date',
    'Custom Data 2',
    'Custom Data 3'
  ];

  const response = await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1:N1',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [headers]
    }
  });

  console.log('Headers created:', response.data);
  return response.data;
}

/**
 * Get all rows from Google Sheet (utility function)
 * 
 * Useful for debugging or retrieving subscription records.
 * 
 * @returns {Promise<Array>} Array of row data
 */
async function getAllRows() {
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!sheetId) {
    throw new Error('Google Sheet ID not configured.');
  }

  const sheets = await getGoogleSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:N'
  });

  return response.data.values || [];
}

/**
 * Find row by submission ID (utility function)
 * 
 * Searches for a specific submission in the sheet.
 * 
 * @param {string} submissionId - The submission ID to find
 * @returns {Promise<Object|null>} Row data or null if not found
 */
async function findBySubmissionId(submissionId) {
  const rows = await getAllRows();
  
  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[1] === submissionId) { // Column B is Submission ID
      return {
        rowIndex: i + 1, // 1-indexed for Sheets
        data: {
          timestamp: row[0],
          submissionId: row[1],
          pfPaymentId: row[2],
          paymentStatus: row[3],
          firstName: row[4],
          lastName: row[5],
          email: row[6],
          amountGross: row[7],
          amountNet: row[8],
          itemName: row[9],
          token: row[10],
          billingDate: row[11]
        }
      };
    }
  }
  
  return null;
}

module.exports = {
  appendToGoogleSheet,
  createSheetHeaders,
  getAllRows,
  findBySubmissionId
};
