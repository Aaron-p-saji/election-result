const axios = require('axios');
const cheerio = require('cheerio');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1dHBQs3lrndB83y24E-424AUfXUnfESzKZV8PYqMoDCc';
const BIGTV_API = 'https://bigtv-election.onrender.com/api/candidates/results';
const REPORTER_SUMMARY_API = 'https://election.reporterlive.com/api/widget/election-2026/summary';
const REPORTER_CONSTITUENCY_BASE = 'https://election.reporterlive.com/api/widget/election-2026/constituency/';

async function updateElectionSheet() {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Fetch BigTV Data (Primary Map)
        const bigTvRes = await axios.get(BIGTV_API, { headers: { 'Referer': 'https://electionresult.bigtv24x7.com/' } });
        const bigTvMap = {};
        bigTvRes.data.forEach(c => {
            if (c.leadingPosition === "LEADING") bigTvMap[c.constituencyId.nameMl.trim()] = c.partyNameEn;
        });

        // 2. Fetch Reporter Live Summary & Build Language Bridge
        console.log('Fetching Reporter Live data...');
        const reporterSummary = await axios.get(REPORTER_SUMMARY_API);
        const summaryData = reporterSummary.data.data;
        const summaryWinners = summaryData.winners_by_slug || {};
        
        // This map will help us find the English slug using the Malayalam name from your sheet
        const mlToSlugMap = {};
        const slugToEnName = {};
        
        // Primary and Secondary sliders usually contain the Malayalam names
        const allCandidates = [...summaryData.primary_slider, ...summaryData.secondary_slider];
        allCandidates.forEach(cand => {
            const mlName = cand.name_ml || cand.constituency.name_ml;
            if (mlName) {
                mlToSlugMap[mlName.trim()] = cand.constituency.slug;
                slugToEnName[cand.constituency.slug] = cand.constituency.name_en;
            }
        });

        // 3. Process the "NEW" Sheet (140 Rows)
        const sheetName = 'NEW';
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A2:G141`,
        });
        
        const rows = res.data.values;
        if (!rows) {
            console.log('Sheet NEW is empty or range A2:G141 not found.');
            return;
        }

        let nTotal = 0, jTotal = 0;
        const updatedRows = [];

        for (const row of rows) {
            const mlNameInSheet = (row[1] || "").trim();
            const slug = mlToSlugMap[mlNameInSheet];
            
            // PRIORITY 1: BigTV (Malayalam Match)
            let winnerAlliance = bigTvMap[mlNameInSheet];

            // PRIORITY 2: Reporter Live winners_by_slug
            if (!winnerAlliance && slug && summaryWinners[slug]) {
                winnerAlliance = summaryWinners[slug];
            }

            // PRIORITY 3: Deep Dive for specific slug if no winner yet
            if (!winnerAlliance && slug) {
                try {
                    const detail = await axios.get(`${REPORTER_CONSTITUENCY_BASE}${slug}`);
                    const cand = detail.data.data.candidates.find(c => c.status === "won" || c.status === "leading");
                    if (cand) winnerAlliance = cand.alliance;
                } catch (e) { /* ignore detail fail */ }
            }

            // Fallback to existing value if still nothing
            const finalWinner = winnerAlliance || row[4] || "";
            
            const nScore = (finalWinner && row[2] === finalWinner) ? 1 : 0;
            const jScore = (finalWinner && row[3] === finalWinner) ? 1 : 0;
            nTotal += nScore; jTotal += jScore;

            updatedRows.push([row[0], row[1], row[2], row[3], finalWinner, nScore, jScore]);
        }

        // 4. Update the "NEW" Sheet
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!A2`,
            valueInputOption: 'RAW',
            resource: { values: updatedRows },
        });

        // Update Total Points Row for NEW sheet
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${sheetName}!F142:G142`,
            valueInputOption: 'RAW',
            resource: { values: [[nTotal, jTotal]] },
        });

        console.log('✅ Sheet "NEW" updated for all 140 constituencies.');
        process.exit(0);
    } catch (error) {
        console.error('Critical Error:', error.message);
        process.exit(1);
    }
}

updateElectionSheet();
