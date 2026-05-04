const axios = require('axios');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1dHBQs3lrndB83y24E-424AUfXUnfESzKZV8PYqMoDCc';
// Using the exact API URL from your debug log
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
                'Accept': 'application/json, text/plain, */*',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        // Map live results: { "Manjeshwar": "LDF", ... }
        const liveResultsMap = {};
        data.forEach(candidate => {
            if (candidate.leadingPosition === "LEADING") {
                const constituency = candidate.constituencyId.nameEn;
                const party = candidate.partyNameEn;
                if (constituency) liveResultsMap[constituency] = party;
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
                const constituency = row[1]; 
                const nikhilPred = row[2];   
                const janePred = row[3];     
                
                const actualWinner = liveResultsMap[constituency] || row[4] || "";
                
                const nikhilScore = (actualWinner && nikhilPred === actualWinner) ? 1 : 0;
                const janeScore = (actualWinner && janePred === actualWinner) ? 1 : 0;

                nikhilTotal += nikhilScore;
                janeTotal += janeScore;

                return [row[0], constituency, nikhilPred, janePred, actualWinner, nikhilScore, janeScore];
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2`,
                valueInputOption: 'RAW',
                resource: { values: updatedRows },
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!F142:G142`,
                valueInputOption: 'RAW',
                resource: { values: [[nikhilTotal, janeTotal]] },
            });
        }

        console.log(`✅ Update successful. Processed ${Object.keys(liveResultsMap).length} leads.`);
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.response ? `Status ${error.response.status}` : error.message);
        process.exit(1);
    }
}

updateElectionSheet();
