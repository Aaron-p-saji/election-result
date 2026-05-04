const axios = require('axios');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1dHBQs3lrndB83y24E-424AUfXUnfESzKZV8PYqMoDCc';
// Update this to the exact API endpoint you found in the Network tab
const API_URL = 'https://bigtv-election.onrender.com/api/candidates/results?t=1777865655678'; 

async function updateElectionSheet() {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        console.log('Fetching live JSON data from Big TV...');
        const { data } = await axios.get(API_URL);

        // Map live results: { "Manalur": "LDF", "Mananthavady": "UDF", ... }
        const liveResultsMap = {};

        data.forEach(candidate => {
            // We only care about the candidate currently marked as LEADING
            if (candidate.leadingPosition === "LEADING") {
                const constituency = candidate.constituencyId.nameEn;
                const party = candidate.partyNameEn;
                liveResultsMap[constituency] = party;
            }
        });

        const sheetNames = ['Full_Predictions', 'Differences'];

        for (const sheetName of sheetNames) {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2:G141`,
            });

            const rows = res.data.values;
            if (!rows) continue;

            let nikhilTotal = 0;
            let janeTotal = 0;

            const updatedRows = rows.map(row => {
                const constituency = row[1]; // Column B (English Name)
                const nikhilPred = row[2];   // Column C
                const janePred = row[3];     // Column D
                
                // Get leading party from JSON map, or keep existing value
                const actualWinner = liveResultsMap[constituency] || row[4] || "";
                
                // Score calculation
                const nikhilScore = (actualWinner && nikhilPred === actualWinner) ? 1 : 0;
                const janeScore = (actualWinner && janePred === actualWinner) ? 1 : 0;

                nikhilTotal += nikhilScore;
                janeTotal += janeScore;

                return [row[0], constituency, nikhilPred, janePred, actualWinner, nikhilScore, janeScore];
            });

            // Write updated rows back to the sheet
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2`,
                valueInputOption: 'RAW',
                resource: { values: updatedRows },
            });

            // Update Total Points at the bottom
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!F142:G142`,
                valueInputOption: 'RAW',
                resource: { values: [[nikhilTotal, janeTotal]] },
            });
        }

        console.log(`✅ Success! Processed ${Object.keys(liveResultsMap).length} leads.`);
        process.exit(0);
    } catch (error) {
        console.error('Scraper Error:', error.message);
        process.exit(1);
    }
}

updateElectionSheet();
