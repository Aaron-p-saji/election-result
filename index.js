const axios = require('axios');
const cheerio = require('cheerio');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1dHBQs3lrndB83y24E-424AUfXUnfESzKZV8PYqMoDCc';
const BIGTV_API = 'https://bigtv-election.onrender.com/api/candidates/results';
const REPORTER_SUMMARY_API = 'https://election.reporterlive.com/api/widget/election-2026/summary';
const REPORTER_CONSTITUENCY_BASE = 'https://election.reporterlive.com/api/widget/election-2026/constituency/';

const SPECIFIC_SLUGS = [
    'perambra', 'thiruvambady', 'thavanur', 'pattambi', 'kodungallur', 
    'vypen', 'kochi', 'changanassery', 'kuttanad', 'kayamkulam', 
    'adoor', 'kazhakkoottam', 'vattiyoorkavu', 'thiruvananthapuram'
];

async function updateElectionSheet() {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const auth = new google.auth.GoogleAuth({
            credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Fetch BigTV Data (Primary source for Malayalam sheets)
        const bigTvRes = await axios.get(BIGTV_API, { headers: { 'Referer': 'https://electionresult.bigtv24x7.com/' } });
        const bigTvMap = {};
        bigTvRes.data.forEach(c => {
            if (c.leadingPosition === "LEADING") bigTvMap[c.constituencyId.nameMl.trim()] = c.partyNameEn;
        });

        // 2. Fetch Reporter Live Data & Create Language Bridge
        console.log('Fetching Reporter Live data...');
        const reporterSummary = await axios.get(REPORTER_SUMMARY_API);
        const summaryData = reporterSummary.data.data;
        const summaryWinners = summaryData.winners_by_slug || {};
        
        const reporterMapEn = {}; // Key: English Name
        const reporterMapMl = {}; // Key: Malayalam Name
        const allConsts = summaryData.districts.flatMap(d => d.constituencies);

        // Process all 140 constituencies for the Full sheet
        // We use the winners_by_slug first
        for (const [slug, alliance] of Object.entries(summaryWinners)) {
            const detail = allConsts.find(c => c.slug === slug);
            if (detail) {
                // We don't have Malayalam names in the basic constituency list, 
                // so we fetch them from the slider data or the detailed API if needed.
                reporterMapEn[detail.name_en.trim()] = alliance;
            }
        }

        // Deep dive for the 14 Specific Slugs (Reporter Report Sheet)
        for (const slug of SPECIFIC_SLUGS) {
            try {
                const detailRes = await axios.get(`${REPORTER_CONSTITUENCY_BASE}${slug}`);
                const data = detailRes.data.data;
                const winner = data.candidates.find(c => c.status === "won" || c.status === "leading");
                
                if (winner) {
                    reporterMapEn[data.name_en.trim()] = winner.alliance;
                    // Bridge to Malayalam for the Full Predictions sheet
                    const mlName = data.candidates[0].constituency.name_ml || ""; 
                    if (mlName) reporterMapMl[mlName.trim()] = winner.alliance;
                }
            } catch (e) { console.log(`Detail fetch failed for ${slug}`); }
        }

        // 3. Update Function
        const processSheet = async (sheetName, isReporterSheet) => {
            console.log(`Updating ${sheetName}...`);
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2:G141`,
            });
            const rows = res.data.values;
            if (!rows) return;

            let nTotal = 0, jTotal = 0;
            const updatedRows = rows.map(row => {
                const nameInSheet = (row[1] || "").trim();
                let actualWinner = row[4] || "";

                if (isReporterSheet) {
                    // REPORTER REPORT uses English names
                    actualWinner = reporterMapEn[nameInSheet] || row[4] || "";
                } else {
                    // Full_Predictions & Differences use Malayalam names
                    // Priority: BigTV -> Reporter Malayalam Bridge -> Current Value
                    actualWinner = bigTvMap[nameInSheet] || reporterMapMl[nameInSheet] || row[4] || "";
                }

                const nScore = (actualWinner && row[2] === actualWinner) ? 1 : 0;
                const jScore = (actualWinner && row[3] === actualWinner) ? 1 : 0;
                nTotal += nScore; jTotal += jScore;

                return [row[0], row[1], row[2], row[3], actualWinner, nScore, jScore];
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
                resource: { values: [[nTotal, jTotal]] },
            });
        };

        // 4. Execution
        await processSheet('Full_Predictions', false);
        await processSheet('Differences', false);
        await processSheet('REPORTER REPORT', true);

        console.log('✅ All 140 constituencies and special reports updated.');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

updateElectionSheet();
