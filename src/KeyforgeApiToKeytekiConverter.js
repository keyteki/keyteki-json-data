const fs = require('fs');
const request = require('request');

const ValidKeywords = [
    'elusive',
    'skirmish',
    'taunt',
    'deploy',
    'alpha',
    'omega',
    'hazardous',
    'assault',
    'poison',
    'splash-attack',
    'treachery',
    'versatile'
];

function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        request(url, options, (err, res, body) => {
            if (err) {
                if (res) {
                    err.statusCode = res.statusCode;
                }

                return reject(err);
            }

            if (res.statusCode !== 200) {
                let err = new Error('Request failed');
                if (res) {
                    err.statusCode = res.statusCode;
                    err.res = res;
                }

                return reject(err);
            }

            resolve(body);
        });
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class KeyforgeApiToKeytekiConverter {
    async convert({ pathToPackFile, language, cyclePrefix }) {
        console.log('Loading ' + language + ' cards...');

        let pack = JSON.parse(fs.readFileSync(pathToPackFile));

        this.cyclePrefix = cyclePrefix;

        let cards;
        try {
            cards = await this.getCards(pack, language);
        } catch (err) {
            console.info(err);
            return;
        }

        if (!cards) {
            return;
        }

        cards.sort((a, b) => (a.number < b.number ? -1 : 1));

        console.info(`Got ${cards.length} cards`);

        if (cards.length === 0) {
            console.error('Cards corresponding to', pack.name, 'have not been released yet.');
            return;
        }

        pack.cards = cards;

        fs.writeFileSync(pathToPackFile, JSON.stringify(pack, null, 4) + '\n');
        console.log('Import of cards for', pack.name, 'has been completed.');
    }

    async getCards(pack, language) {
        const pageSize = 10;
        const apiUrl = 'https://www.keyforgegame.com/api/decks';

        console.info('Fetching the deck list...');

        let packCardMap = pack.cards.reduce(function (map, obj) {
            let cardKey = `${obj.number}/${obj.type}/${obj.house}/${obj.rarity.toLowerCase()}`;

            map[cardKey] = obj;
            return map;
        }, {});

        let response;
        let cards = {};
        let pageErrors = [];

        let responseReceived = false;

        while (!responseReceived) {
            try {
                response = await httpRequest(`${apiUrl}/?expansion=${pack.ids[0]}`, {
                    json: true,
                    headers: { 'Accept-Language': language }
                });
                responseReceived = true;
            } catch (err) {
                let res = err.res;

                if (res && res.statusCode === 429) {
                    let timeoutMatch = res.body.detail.match(/(\d+)/);
                    let timeout = timeoutMatch[1] * 2;

                    console.info(`API calls being throttled, sleeping for ${timeout} seconds`);

                    await sleep(timeout * 1000);

                    continue;
                } else {
                    console.info(err.res.body);
                    return;
                }
            }
        }

        let deckCount = response.count;
        let totalPages = Math.ceil(deckCount / pageSize);

        console.info(`Fetching all ${deckCount} decks, which is ${totalPages} pages`);

        console.info(`Looking for ${pack.cardCount} cards`);

        let stupidCards = { MM341: true };

        for (let i = 1; i <= totalPages; i++) {
            try {
                response = await httpRequest(
                    `${apiUrl}/?page=${i}&links=cards&page_size=${pageSize}&expansion=${pack.ids[0]}&ordering=date`,
                    { json: true, headers: { 'Accept-Language': language } }
                );
            } catch (err) {
                let res = err.res;

                if (res && res.statusCode === 429) {
                    let timeoutMatch = res.body.detail.match(/(\d+)/);
                    let timeout = timeoutMatch[1] * 2;

                    console.info(`API calls being throttled, sleeping for ${timeout} seconds`);

                    await sleep(timeout * 1000);

                    i--;
                    continue;
                } else {
                    pageErrors.push(i);

                    console.info(`Page ${i} failed, will try it later`);
                    continue;
                }
            }

            if (!response) {
                pageErrors.push(i);

                console.info(`Page ${i} failed, will try it later`);
                continue;
            }

            for (let card of response._linked.cards) {
                // Fix the house of an anomalies and other special
                // cards to brobnar so that we can test them until
                // they get a real house
                if (card.is_anomaly || card.card_number.startsWith('S')) {
                    card.house = 'brobnar';
                }

                if (card.rarity === 'FIXED') {
                    card.rarity = 'Special';
                }

                let cardKey = `${card.card_number}/${card.card_type}/${
                    card.house
                }/${card.rarity.toLowerCase()}`;
                let stupidKey = pack.code + card.card_number;
                if (
                    !pack.ids.includes('' + card.expansion) ||
                    cards[cardKey] ||
                    (card.is_maverick && !stupidCards[stupidKey])
                ) {
                    continue;
                }

                let newCard = null;

                if (language === 'en') {
                    newCard = {
                        id: card.card_title
                            .toLowerCase()
                            .replace(/[?.!",“”]/gi, '')
                            .replace(/[ '’]/gi, '-'),
                        name: card.card_title,
                        number: card.card_number,
                        image: card.front_image,
                        expansion: card.expansion,
                        house: card.house.toLowerCase().replace(' ', ''),
                        keywords: this.parseKeywords(card.card_text),
                        traits: !card.traits
                            ? []
                            : card.traits.split(' • ').map((trait) => trait.toLowerCase()),
                        type: card.card_type.toLowerCase(),
                        rarity: card.rarity,
                        amber: card.amber === '' ? 0 : parseInt(card.amber),
                        armor: card.card_type.toLowerCase().startsWith('creature')
                            ? card.armor !== ''
                                ? parseInt(card.armor)
                                : 0
                            : null,
                        power: card.power === '' ? null : parseInt(card.power),
                        text: card.card_text,
                        locale: {
                            en: {
                                name: card.card_title
                            }
                        }
                    };

                    if (newCard.rarity == 'Evil Twin') {
                        newCard.id = newCard.id + '-evil-twin';
                    }
                } else {
                    // Append locale information
                    let type = card.card_type;
                    if (card.card_type === 'Creature1' || card.card_type === 'Creature2') {
                        card.card_type = card.card_type.toLowerCase();
                        type = 'Creature';
                    }

                    let cardKey = `${card.card_number}/${type.toLowerCase()}/${card.house
                        .toLowerCase()
                        .replace(' ', '')}/${card.rarity.toLowerCase()}`;
                    newCard = packCardMap[cardKey];

                    if (!newCard.locale) {
                        // Just a safe check, but since 'en' is supposed to be loaded first, locale
                        // will already exist
                        newCard.locale = [];
                    }

                    newCard.locale[language.replace('-', '')] = {
                        name: card.card_title
                    };
                }

                // Sort locale by key
                newCard.locale = Object.keys(newCard.locale)
                    .sort()
                    .reduce((newLocale, currentValue) => {
                        newLocale[currentValue] = newCard.locale[currentValue];
                        return newLocale;
                    }, {});

                cards[cardKey] = newCard;
            }

            if (Object.values(cards).length == pack.cardCount) {
                console.info(`Got all the cards we were expecting after ${i} pages`);

                break;
            }

            if (i % 10 === 0) {
                console.info(
                    `Processed ${i} pages, ${totalPages - i} to go. Have ${
                        Object.values(cards).length
                    } cards so far, expecting ${pack.cardCount}`
                );
            }
        }

        for (let card of Object.values(cards)) {
            if (card.type === 'creature1') {
                card.type = 'creature';
            } else if (card.type === 'creature2') {
                card.type = 'creature';
                card.id += '2';

                let cardKey = `${card.number}/Creature1/${
                    card.house.charAt(0).toUpperCase() + card.house.slice(1)
                }`;

                if (!cards[cardKey]) {
                    console.info('No card found', cardKey);
                }

                card.power = cards[cardKey].power;
                card.amber = cards[cardKey].amber;
                card.armor = cards[cardKey].armor;
            }
        }

        return Object.values(cards);
    }

    parseKeywords(text) {
        let lines = text.split(/[\n\r\v]/);
        let potentialKeywords = [];

        for (let line of lines) {
            potentialKeywords = potentialKeywords.concat(
                line.split('.').map((k) => k.toLowerCase().trim().replace(' ', ':'))
            );
        }

        let printedKeywords = potentialKeywords.filter((potentialKeyword) => {
            return ValidKeywords.some((keyword) => potentialKeyword.indexOf(keyword) === 0);
        });

        return printedKeywords;
    }
}

module.exports = KeyforgeApiToKeytekiConverter;
