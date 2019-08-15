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
    'poison'
];

function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        request(url, options, (err, res, body) => {
            if(err) {
                if(res) {
                    err.statusCode = res.statusCode;
                }

                return reject(err);
            }

            if(res.statusCode !== 200) {
                let err = new Error('Request failed');
                err.statusCode = res.statusCode;

                return reject(err);
            }

            resolve(body);
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class KeyforgeApiToKeytekiConverter {
    async convert({ pathToPackFile, language, cyclePrefix }) {

        console.log('Loading ' + language + ' cards...');

        let pack = JSON.parse(fs.readFileSync(pathToPackFile));

        this.cyclePrefix = cyclePrefix;

        let cards = await this.getCards(pack, language);

        cards.sort((a, b) => a.number < b.number ? -1 : 1);

        if(cards.length === 0) {
            console.error('Cards corresponding to', pack.name, 'have not been released yet.');
            return;
        }

        pack.cards = cards;

        fs.writeFileSync(pathToPackFile, JSON.stringify(pack, null, 4) + '\n');
        console.log('Import of cards for', pack.name, 'has been completed.');
    }

    async getCards(pack, language) {
        const pageSize = 50;
        const apiUrl = 'https://www.keyforgegame.com/api/decks/';

        console.info('Fetching the deck list...');

        let packCardMap = pack.cards.reduce(function(map, obj) {
            map[obj.number] = obj;
            return map;
        }, {});

        let response;
        let cards = {};
        let pageErrors = [];

        try {
            response = await httpRequest(apiUrl, { json: true, headers: { 'Accept-Language': language } });
        } catch(err) {
            console.info(err);

            return;
        }

        let deckCount = response.count;
        let totalPages = Math.ceil(deckCount / pageSize);

        console.info(`Fetching all ${deckCount} decks, which is ${totalPages} pages`);

        for(let i = 1; i < totalPages; i++) {
            try {
                response = await httpRequest(`${apiUrl}/?page=${i}&links=cards&page_size=${pageSize}&ordering=-date`, { json: true, headers: { 'Accept-Language': language } });
            } catch(err) {
                if(err.statusCode === 429) {
                    await sleep(100);
                    i--;
                    continue;
                }

                pageErrors.push(i);

                console.info(`Page ${i} failed, will try it later`);
                continue;
            }

            if(!response) {
                pageErrors.push(i);

                console.info(`Page ${i} failed, will try it later`);
                continue;
            }

            for(let card of response._linked.cards) {
                if(card.expansion != pack.id || cards[card.card_number] || card.is_maverick) {
                    continue;
                }

                let newCard = null;

                if (language === 'en')  {

                    newCard = {
                        id: card.card_title.toLowerCase().replace(/[?.!",“”]/gi, '').replace(/[ '’]/gi, '-'),
                        name: card.card_title,
                        number: card.card_number,
                        image: card.front_image,
                        expansion: card.expansion,
                        house: card.house.toLowerCase(),
                        keywords: this.parseKeywords(card.card_text),
                        traits: !card.traits ? [] : card.traits.split(' • ').map(trait => trait.toLowerCase()),
                        type: card.card_type.toLowerCase(),
                        rarity: card.rarity,
                        amber: card.amber === '' ? 0 : parseInt(card.amber),
                        armor: card.card_type.toLowerCase() === 'creature' ? (card.armor !== '' ? parseInt(card.armor) : 0) : null,
                        power: card.power === '' ? null : parseInt(card.power),
                        text: card.card_text,
                        locale: {
                            'en': {
                                name: card.card_title
                            }
                        }
                    };
                } else {
                    // Append locale information
                    newCard = packCardMap[card.card_number];

                    if (!newCard.locale) {
                        // Just a safe check, but since 'en' is supposed to be loaded first, locale
                        // will already exist
                        newCard.locale = [];
                    }

                    newCard.locale[language.replace('-', '')] = {
                        name: card.card_title
                    };

                };

                // Sort locale by key
                newCard.locale = Object.keys(newCard.locale).sort().reduce((newLocale, currentValue) => {
                      newLocale[currentValue] = newCard.locale[currentValue];
                      return newLocale;
                    }, {});

                cards[card.card_number] = newCard;
            }

            if(Object.values(cards).length == pack.cardCount) {
                console.info(`Got all the cards we were expecting after ${i} pages`);

                break;
            }

            if(i % 10 === 0) {
                console.info(`Processed ${i} pages, ${totalPages - i} to go. Have ${Object.values(cards).length} cards so far, expecting ${pack.cardCount}`);
            }
        }

        return Object.values(cards);
    }

    parseKeywords(text) {
        let lines = text.split(/[\r\v]/);
        let potentialKeywords = [];

        for(let line of lines) {
            potentialKeywords = potentialKeywords.concat(line.split('.').map(k => k.toLowerCase().trim().replace(' ', ':')));
        }

        let printedKeywords = potentialKeywords.filter(potentialKeyword => {
            return ValidKeywords.some(keyword => potentialKeyword.indexOf(keyword) === 0);
        });

        return printedKeywords;
    }
}

module.exports = KeyforgeApiToKeytekiConverter;
