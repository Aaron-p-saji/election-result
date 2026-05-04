const axios = require('axios');
const cheerio = require('cheerio');
const { google } = require('googleapis');

// --- Configuration ---
const SPREADSHEET_ID = '1dHBQs3lrndB83y24E-424AUfXUnfESzKZV8PYqMoDCc';
const ECI_URL = 'https://results.eci.gov.in/'; 

async function updateElectionSheet() {
    try {
        // 1. Authenticate using GitHub Secret
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        console.log('Fetching live results...');
        const response = await axios.get(ECI_URL, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0'
    }
});
        const $ = cheerio.load(response.data);

        // Map live results
        const liveResultsMap = {};
        $('.constituency-row').each((i, el) => {
            const name = $(el).find('.name').text().trim();
            const winner = $(el).find('.winner-party').text().trim(); 
            if (name) liveResultsMap[name] = winner;
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

        console.log('✅ Sheet updated successfully.');
        process.exit(0); // Exit clean for GitHub Actions
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1); // Fail the job so you get a notification
    }
}

updateElectionSheet();
