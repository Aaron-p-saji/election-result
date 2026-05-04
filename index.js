const axios = require('axios');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1dHBQs3lrndB83y24E-424AUfXUnfESzKZV8PYqMoDCc';
const API_URL = 'https://bigtv-election.onrender.com/api/candidates/results'; 

async function updateElectionSheet() {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        console.log('Fetching live results from BigTV API...');
        
        const { data } = await axios.get(API_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
                'Origin': 'https://electionresult.bigtv24x7.com',
                'Referer': 'https://electionresult.bigtv24x7.com/',
                'Accept': 'application/json, text/plain, */*'
            }
        });

        // Map live results using nameMl: { "അടൂർ": "LDF", "പേരാമ്പ്ര": "LDF", ... }
        const liveResultsMap = {};
        data.forEach(candidate => {
            // Check if this candidate is currently leading
            if (candidate.leadingPosition === "LEADING") {
                const constituencyMl = candidate.constituencyId.nameMl;
                const partyEn = candidate.partyNameEn; // This gives 'LDF', 'UDF', or 'NDA'
                
                if (constituencyMl) {
                    liveResultsMap[constituencyMl] = partyEn;
                }
            }
        });

        const sheetNames = ['Full_Predictions', 'Differences'];

        for (const sheetName of sheetNames) {
            // Read the data range (Columns A to G)
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2:G141`,
            });

            const rows = res.data.values;
            if (!rows) continue;

            let nikhilTotal = 0;
            let janeTotal = 0;

            const updatedRows = rows.map(row => {
                const constituencyMlName = row[1]; // Column B (Malayalam Name)
                const nikhilPred = row[2];         // Column C
                const janePred = row[3];           // Column D
                
                // 1. Check if the API has a leading party for this Malayalam name
                // 2. Fallback to the current value in Column E if no lead is found yet
                const actualWinner = liveResultsMap[constituencyMlName] || row[4] || "";
                
                // Score Logic: 1 point if the prediction exactly matches the leading party
                const nikhilScore = (actualWinner && nikhilPred === actualWinner) ? 1 : 0;
                const janeScore = (actualWinner && janePred === actualWinner) ? 1 : 0;

                nikhilTotal += nikhilScore;
                janeTotal += janeScore;

                // Return the updated row format
                return [row[0], constituencyMlName, nikhilPred, janePred, actualWinner, nikhilScore, janeScore];
            });

            // Update the main data rows (A2:G141)
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2`,
                valueInputOption: 'RAW',
                resource: { values: updatedRows },
            });

            // Update Total Points Row (Updating only Columns F and G at the bottom)
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!F142:G142`,
                valueInputOption: 'RAW',
                resource: { values: [[nikhilTotal, janeTotal]] },
            });
        }

        console.log(`✅ Success! Data updated for ${Object.keys(liveResultsMap).length} constituencies.`);
        process.exit(0);
    } catch (error) {
        console.error('Update Error:', error.message);
        process.exit(1);
    }
}

updateElectionSheet();
