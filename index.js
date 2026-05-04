const axios = require('axios');
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

        // 1. Fetch BigTV Data (For Malayalam matching sheets)
        const bigTvRes = await axios.get(BIGTV_API, { headers: { 'Referer': 'https://electionresult.bigtv24x7.com/' } });
        const bigTvMap = {};
        bigTvRes.data.forEach(c => {
            if (c.leadingPosition === "LEADING") bigTvMap[c.constituencyId.nameMl.trim()] = c.partyNameEn;
        });

        // 2. Fetch Reporter Live Data (For English matching sheet)
        console.log('Fetching Reporter Live data...');
        const reporterSummary = await axios.get(REPORTER_SUMMARY_API);
        const reporterMap = {};

        // Reporter API structure: districts -> constituencies -> slug
        const districts = reporterSummary.data.data.districts;
        
        // Map live results to find BOTH leader and trailer
const liveResultsMap = {};

for (const district of districts) {
    for (const constInfo of district.constituencies) {
        try {
            const detailRes = await axios.get(`${REPORTER_CONSTITUENCY_BASE}${constInfo.slug}`);
            const candidates = detailRes.data.data.candidates;
            
            // Find the candidate explicitly marked as "leading"
            const leader = candidates.find(cand => cand.status === "leading");
            // Find the candidate explicitly marked as "trailing"
            const trailer = candidates.find(cand => cand.status === "trailing");

            // Store both in the map for the constituency
            reporterMap[constInfo.name_en.trim()] = {
                leading: leader ? leader.alliance : "N/A",
                trailing: trailer ? trailer.alliance : "N/A"
            };
        } catch (e) {
            console.error(`Could not fetch details for ${constInfo.slug}`);
        }
    }
}
        }

        // 3. Update Sheets
        const updateSheet = async (sheetName, liveMap) => {
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2:G141`,
            });
            const rows = res.data.values;
            if (!rows) return;

            let nikhilTotal = 0, janeTotal = 0;

            const updatedRows = rows.map(row => {
                const nameInSheet = (row[1] || "").trim();
                const actualWinner = liveMap[nameInSheet] || row[4] || "";
                
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

        // Run updates
        await updateSheet('Full_Predictions', bigTvMap);
        await updateSheet('Differences', bigTvMap);
        await updateSheet('REPORTER REPORT', reporterMap);

        console.log('✅ All reports updated based on current leaders.');
        process.exit(0);
    } catch (error) {
        console.error('Workflow Error:', error.message);
        process.exit(1);
    }
}

updateElectionSheet();
