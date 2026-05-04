const axios = require('axios');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1dHBQs3lrndB83y24E-424AUfXUnfESzKZV8PYqMoDCc';
const BIGTV_API = 'https://bigtv-election.onrender.com/api/candidates/results';
const REPORTER_API = 'https://election.reporterlive.com/api/widget/election-2026/summary';

async function updateElectionSheet() {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Fetch BigTV Data (Malayalam matching)
        console.log('Fetching BigTV results...');
        const bigTvRes = await axios.get(BIGTV_API, {
            headers: { 'Referer': 'https://electionresult.bigtv24x7.com/' }
        });
        const bigTvMap = {};
        bigTvRes.data.forEach(c => {
            if (c.leadingPosition === "LEADING") {
                const mlName = (c.constituencyId.nameMl || "").trim();
                bigTvMap[mlName] = c.partyNameEn;
            }
        });

        // 2. Fetch Reporter Live Data (English matching)
        console.log('Fetching Reporter Live results...');
        const reporterRes = await axios.get(REPORTER_API);
        const reporterMap = {};
        
        // Combining primary and secondary candidate sliders
        const reporterCandidates = [
            ...reporterRes.data.data.primary_slider, 
            ...reporterRes.data.data.secondary_slider
        ];

        reporterCandidates.forEach(c => {
            if (c.status === "leading") {
                // Using constituency.name_en specifically for this sheet
                const enName = (c.constituency.name_en || "").trim();
                reporterMap[enName] = c.alliance;
            }
        });

        // 3. Helper function to process sheets
        const updateSheetData = async (sheetName, liveMap) => {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2:G141`,
            });
            const rows = res.data.values;
            if (!rows) return;

            let nikhilTotal = 0;
            let janeTotal = 0;

            const updatedRows = rows.map(row => {
                const constituencyInSheet = (row[1] || "").trim();
                
                // Get lead from map or keep current value in Column E
                const actualWinner = liveMap[constituencyInSheet] || row[4] || "";
                
                const nikhilScore = (actualWinner && row[2] === actualWinner) ? 1 : 0;
                const janeScore = (actualWinner && row[3] === actualWinner) ? 1 : 0;

                nikhilTotal += nikhilScore;
                janeTotal += janeScore;

                return [row[0], row[1], row[2], row[3], actualWinner, nikhilScore, janeScore];
            });

            // Update main range
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2`,
                valueInputOption: 'RAW',
                resource: { values: updatedRows },
            });

            // Update Total Points row
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!F142:G142`,
                valueInputOption: 'RAW',
                resource: { values: [[nikhilTotal, janeTotal]] },
            });
        };

        // 4. Execute Updates
        // Update Malayalam sheets from BigTV
        await updateSheetData('Full_Predictions', bigTvMap);
        await updateSheetData('Differences', bigTvMap);

        // Update English sheet from Reporter Live
        await updateSheetData('REPORTER REPORT', reporterMap);

        console.log('✅ All sheets updated successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Update Failed:', error.message);
        process.exit(1);
    }
}

updateElectionSheet();
