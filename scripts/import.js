const path = require('path');
const KeyforgeApiToKeytekiConverter = require('../src/KeyforgeApiToKeytekiConverter');

let converter = new KeyforgeApiToKeytekiConverter();

const Languages = ['en', 'de', 'es', 'fr', 'it', 'pl', 'pt', 'ru', 'th', 'vi', 'zhhans', 'zhhant'];

// Parse --deck flag from arguments
function parseDeckIds() {
    const deckIdx = process.argv.indexOf('--deck');
    if (deckIdx === -1) {
        return null;
    }
    const ids = [];
    for (let i = deckIdx + 1; i < process.argv.length; i++) {
        if (process.argv[i].startsWith('--')) {
            break;
        }
        ids.push(process.argv[i]);
    }
    return ids.length > 0 ? ids : null;
}

function hasClearFlag() {
    return process.argv.includes('--clear');
}

const doImport = async () => {
    const deckIds = parseDeckIds();

    if (deckIds) {
        // Fetch cards from specific deck(s)
        const language = process.argv.includes('--lang')
            ? process.argv[process.argv.indexOf('--lang') + 1]
            : 'en';
        const clear = hasClearFlag();
        for (const deckId of deckIds) {
            await converter.convertDeck({
                pathToPackFile: path.join(process.cwd(), process.argv[2]),
                cyclePrefix: process.argv[3],
                language: language,
                deckId: deckId,
                clear: clear
            });
        }
    } else if (process.argv[4] === 'all') {
        let pagesToFetch = null;
        for (const language of Languages) {
            const result = await converter.convert({
                pathToPackFile: path.join(process.cwd(), process.argv[2]),
                cyclePrefix: process.argv[3],
                language: language,
                pagesToFetch: pagesToFetch
            });
            if (result && result.pagesWithNewCards) {
                pagesToFetch = result.pagesWithNewCards;
                console.info(
                    `Recorded ${pagesToFetch.length} pages with new cards for subsequent languages`
                );
            }
        }
    } else {
        await converter.convert({
            pathToPackFile: path.join(process.cwd(), process.argv[2]),
            cyclePrefix: process.argv[3],
            language: process.argv.length > 4 ? process.argv[4] : 'en'
        });
    }
};

doImport()
    .then(() => console.info('complete!'))
    .catch((err) => console.info(err));
