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

        // 1. Fetch BigTV Data (Malayalam Matching)
        console.log('Fetching BigTV results...');
        const bigTvRes = await axios.get(BIGTV_API, { headers: { 'Referer': 'https://electionresult.bigtv24x7.com/' } });
        const bigTvMap = {};
        bigTvRes.data.forEach(c => {
            if (c.leadingPosition === "LEADING") {
                const mlName = (c.constituencyId.nameMl || "").trim();
                bigTvMap[mlName] = c.partyNameEn;
            }
        });

        // 2. Fetch Reporter Live Data (English Matching + Lead/Trail Logic)
        console.log('Fetching Reporter Live data...');
        const reporterSummary = await axios.get(REPORTER_SUMMARY_API);
        const reporterMap = {};

        const districts = reporterSummary.data.data.districts;
        
        for (const district of districts) {
            for (const constInfo of district.constituencies) {
                try {
                    const detailRes = await axios.get(`${REPORTER_CONSTITUENCY_BASE}${constInfo.slug}`);
                    const candidates = detailRes.data.data.candidates;
                    
                    const leader = candidates.find(cand => cand.status === "leading");
                    const trailer = candidates.find(cand => cand.status === "trailing");

                    // Map specific for English Sheet
                    reporterMap[constInfo.name_en.trim()] = {
                        leading: leader ? leader.alliance : null,
                        trailing: trailer ? trailer.alliance : null
                    };
                } catch (e) {
                    console.error(`Could not fetch details for ${constInfo.slug}`);
                }
            }
        }

        // 3. Update Function
        const updateSheet = async (sheetName, liveMap, isReporterSheet) => {
            console.log(`Processing sheet: ${sheetName}`);
            const res = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A2:G141`,
            });
            const rows = res.data.values;
            if (!rows) return;

            let nikhilTotal = 0, janeTotal = 0;

            const updatedRows = rows.map(row => {
                const nameInSheet = (row[1] || "").trim();
                let actualWinner = "";
                let trailingParty = "";

                if (isReporterSheet) {
                    const data = liveMap[nameInSheet] || { leading: null, trailing: null };
                    actualWinner = data.leading || row[4] || "";
                    trailingParty = data.trailing || "";
                } else {
                    // BigTV sheets use a simple string map
                    actualWinner = liveMap[nameInSheet] || row[4] || "";
                }
                
                const nikhilScore = (actualWinner && row[2] === actualWinner) ? 1 : 0;
                const janeScore = (actualWinner && row[3] === actualWinner) ? 1 : 0;

                nikhilTotal += nikhilScore;
                janeTotal += janeScore;

                // If it's the reporter sheet, you could optionally put trailing in Column H
                // For now, keeping your A-G structure
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

        // 4. Run Updates
        await updateSheet('Full_Predictions', bigTvMap, false);
        await updateSheet('Differences', bigTvMap, false);
        await updateSheet('REPORTER REPORT', reporterMap, true);

        console.log('✅ All reports updated successfully.');
        process.exit(0);

    } catch (error) {
        console.error('Workflow Error:', error.message);
        process.exit(1);
    }
}

updateElectionSheet();
