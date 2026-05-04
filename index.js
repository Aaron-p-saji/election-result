const axios = require('axios');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1dHBQs3lrndB83y24E-424AUfXUnfESzKZV8PYqMoDCc';
const BIGTV_API = 'https://bigtv-election.onrender.com/api/candidates/results';
const REPORTER_SUMMARY_API = 'https://election.reporterlive.com/api/widget/election-2026/summary';
const REPORTER_CONSTITUENCY_BASE = 'https://election.reporterlive.com/api/widget/election-2026/constituency/';

// List of slugs for detailed checking if they don't exist in summary
const SPECIFIC_SLUGS = [
    'perambra', 'thiruvambady', 'thavanur', 'pattambi', 'kodungallur', 
    'vypen', 'kochi', 'changanassery', 'kuttanad', 'kayamkulam', 
    'adoor', 'kazhakkoottam', 'vattiyoorkavu', 'thiruvananthapuram'
];

async function updateElectionSheet() {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Fetch BigTV Data
        const bigTvRes = await axios.get(BIGTV_API, { headers: { 'Referer': 'https://electionresult.bigtv24x7.com/' } });
        const bigTvMap = {};
        bigTvRes.data.forEach(c => {
            if (c.leadingPosition === "LEADING") bigTvMap[c.constituencyId.nameMl.trim()] = c.partyNameEn;
        });

        // 2. Fetch Reporter Live Data
        console.log('Fetching Reporter Live data...');
        const reporterSummary = await axios.get(REPORTER_SUMMARY_API);
        const summaryData = reporterSummary.data.data;
        const reporterMap = {};

        // A. Priority 1: Use winners_by_slug from summary
        const summaryWinners = summaryData.winners_by_slug || {};

        // B. Deep Dive into specific slugs
        for (const slug of SPECIFIC_SLUGS) {
            // Check if summary already has a definitive winner
            if (summaryWinners[slug]) {
                const constituencyObj = summaryData.districts.flatMap(d => d.constituencies).find(c => c.slug === slug);
                if (constituencyObj) {
                    reporterMap[constituencyObj.name_en.trim()] = { leading: summaryWinners[slug] };
                    continue;
                }
            }

            // Priority 2: Detailed API call for the specific slug
            try {
                const detailRes = await axios.get(`${REPORTER_CONSTITUENCY_BASE}${slug}`);
                const candidates = detailRes.data.data.candidates;
                
                // Prioritize 'won' status, then 'leading'
                const winner = candidates.find(cand => cand.status === "won") || 
                               candidates.find(cand => cand.status === "leading");
                const trailer = candidates.find(cand => cand.status === "trailing");

                reporterMap[detailRes.data.data.name_en.trim()] = {
                    leading: winner ? winner.alliance : null,
                    trailing: trailer ? trailer.alliance : null
                };
            } catch (e) {
                console.error(`Detail fetch failed for slug: ${slug}`);
            }
        }

        // 3. Update Sheet Function
        const updateSheet = async (sheetName, liveMap, isReporterSheet) => {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2:G141`,
            });
            const rows = res.data.values;
            if (!rows) return;

            let nikhilTotal = 0, janeTotal = 0;

            const updatedRows = rows.map(row => {
                const nameInSheet = (row[1] || "").trim();
                let actualWinner = row[4] || "";

                if (isReporterSheet) {
                    const data = liveMap[nameInSheet];
                    if (data && data.leading) {
                        actualWinner = data.leading;
                    }
                } else {
                    actualWinner = liveMap[nameInSheet] || row[4] || "";
                }
                
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
        };

        // 4. Execution
        await updateSheet('Full_Predictions', bigTvMap, false);
        await updateSheet('Differences', bigTvMap, false);
        await updateSheet('REPORTER REPORT', reporterMap, true);

        console.log('✅ Reports synchronized.');
        process.exit(0);

    } catch (error) {
        console.error('Workflow Error:', error.message);
        process.exit(1);
    }
}

updateElectionSheet();
