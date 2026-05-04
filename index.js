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

        // 2. Fetch Reporter & ECI Data
        console.log('Fetching Election Data...');
        const reporterSummary = await axios.get(REPORTER_SUMMARY_API);
        const summaryData = reporterSummary.data.data;
        const summaryWinners = summaryData.winners_by_slug || {};
        const reporterMap = {};

        // Flatten all constituencies from all districts to find IDs/Slugs easily
        const allConsts = summaryData.districts.flatMap(d => d.constituencies);

        for (const slug of SPECIFIC_SLUGS) {
            const constObj = allConsts.find(c => c.slug === slug);
            if (!constObj) continue;

            let winnerAlliance = summaryWinners[slug];

            // If Summary has no winner, check Reporter Detail
            if (!winnerAlliance) {
                try {
                    const detail = await axios.get(`${REPORTER_CONSTITUENCY_BASE}${slug}`);
                    const cand = detail.data.data.candidates.find(c => c.status === "won" || c.status === "leading");
                    if (cand) winnerAlliance = cand.alliance;
                } catch (e) { console.log(`Reporter detail fail for ${slug}`); }
            }

            // If still no winner, fallback to ECI Scraper
            if (!winnerAlliance) {
                try {
                    const eciUrl = `https://results.eci.gov.in/ResultAcGenMay2026/candidateswise-S11${constObj.id}.htm`;
                    const eciRes = await axios.get(eciUrl);
                    const $ = cheerio.load(eciRes.data);
                    const leadingBox = $('.cand-box').filter((i, el) => {
                        const txt = $(el).find('.status').text().toLowerCase();
                        return txt.includes('leading') || txt.includes('won');
                    });

                    console.log(`ECI ini for ${constObj.id}`);

                    if (leadingBox.length > 0) {
                        const party = leadingBox.find('.nme-prty h6').text().trim();
                        if (party.includes('National Congress')) winnerAlliance = 'UDF';
                        else if (party.includes('Communist') || party.includes('LDF')) winnerAlliance = 'LDF';
                        else if (party.includes('Bharatiya Janata') || party.includes('NDA')) winnerAlliance = 'NDA';
                        else if (party.includes('Kerala Congress')) winnerAlliance = 'UDF';
                    }
                } catch (e) { console.log(`ECI fail for ${constObj.id}`); }
            }

            if (winnerAlliance) {
                reporterMap[constObj.name_en.trim()] = winnerAlliance;
            }
        }

        // 3. Update Sheet Logic
        const processSheet = async (name, liveMap, isReporter) => {
            const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${name}!A2:G141` });
            const rows = res.data.values;
            if (!rows) return;

            let nTotal = 0, jTotal = 0;
            const updated = rows.map(row => {
                const sheetName = (row[1] || "").trim();
                const winner = isReporter ? (reporterMap[sheetName] || row[4] || "") : (liveMap[sheetName] || row[4] || "");
                
                const nScore = (winner && row[2] === winner) ? 1 : 0;
                const jScore = (winner && row[3] === winner) ? 1 : 0;
                nTotal += nScore; jTotal += jScore;

                return [row[0], row[1], row[2], row[3], winner, nScore, jScore];
            });

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${name}!A2`,
                valueInputOption: 'RAW',
                resource: { values: updated }
            });
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${name}!F142:G142`,
                valueInputOption: 'RAW',
                resource: { values: [[nTotal, jTotal]] }
            });
        };

        await processSheet('Full_Predictions', bigTvMap, false);
        await processSheet('Differences', bigTvMap, false);
        await processSheet('REPORTER REPORT', null, true);

        console.log('✅ Update Complete');
        process.exit(0);
    } catch (error) {
        console.error('Critical Error:', error.message);
        process.exit(1);
    }
}

updateElectionSheet();
