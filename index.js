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

        // 1. Fetch BigTV Data
        console.log('Fetching BigTV results...');
        const bigTvRes = await axios.get(BIGTV_API, {
            headers: { 'Referer': 'https://electionresult.bigtv24x7.com/' }
        });
        const bigTvMap = {};
        bigTvRes.data.forEach(c => {
            if (c.leadingPosition === "LEADING") bigTvMap[c.constituencyId.nameMl.trim()] = c.partyNameEn;
        });

        // 2. Fetch Reporter Live Data
        console.log('Fetching Reporter Live results...');
        const reporterRes = await axios.get(REPORTER_API);
        const reporterMap = {};
        
        // Reporter API combines leads in primary and secondary sliders
        const allCandidates = [
            ...reporterRes.data.data.primary_slider, 
            ...reporterRes.data.data.secondary_slider
        ];

        allCandidates.forEach(c => {
            if (c.status === "leading") {
                // Using English name for key as it's cleaner in this API's nested object
                reporterMap[c.constituency_name.trim()] = c.alliance;
            }
        });

        // 3. Process Sheets
        // BigTV Data sheets
        const bigTvSheets = ['Full_Predictions', 'Differences'];
        // New Reporter Live sheet
        const reporterSheets = ['REPORTER REPORT'];

        const processWork = async (targetSheets, liveMap, isEnglishKey) => {
            for (const sheetName of targetSheets) {
                const res = await sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${sheetName}!A2:G141`,
                });
                const rows = res.data.values;
                if (!rows) continue;

                let nikhilTotal = 0;
                let janeTotal = 0;

                const updatedRows = rows.map(row => {
                    // Match based on Malayalam Name (Col B) for BigTV or English Name for Reporter
                    const key = isEnglishKey ? (row[138] ? row[1] : row[1]) : row[1]; // Adjusting for your sheet layout
                    const constituency = (row[1] || "").trim();
                    
                    const actualWinner = liveMap[constituency] || row[4] || "";
                    const nikhilScore = (actualWinner && row[2] === actualWinner) ? 1 : 0;
                    const janeScore = (actualWinner && row[3] === actualWinner) ? 1 : 0;

                    nikhilTotal += nikhilScore;
                    janeTotal += janeScore;

                    return [row[0], row[1], row[2], row[3], actualWinner, nikhilScore, janeScore];
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
        };

        await processWork(bigTvSheets, bigTvMap, false); // Match Malayalam for BigTV
        await processWork(reporterSheets, reporterMap, true); // Match based on names in Reporter sheet

        console.log('✅ All sheets (including REPORTER REPORT) updated.');
        process.exit(0);
    } catch (error) {
        console.error('API Error:', error.message);
        process.exit(1);
    }
}

updateElectionSheet();
