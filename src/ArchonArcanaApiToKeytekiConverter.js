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
                if(res) {
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
    return new Promise(resolve => setTimeout(resolve, ms));
}

class DecksOfKeyforgeApiToKeytekiConverter {
    async convert({ pathToPackFile, language, cyclePrefix }) {
        console.log('Loading ' + language + ' cards...');

        let pack = JSON.parse(fs.readFileSync(pathToPackFile));

        this.cyclePrefix = cyclePrefix;

        let cards;
        try {
            cards = await this.getCards(pack, language);
        } catch(err) {
            console.info(err);
            return;
        }

        cards.sort((a, b) => a.number < b.number ? -1 : 1);

        pack.cards = cards;

        fs.writeFileSync(pathToPackFile, JSON.stringify(pack, null, 4) + '\n');
        console.log('Import of cards for', pack.name, 'has been completed.');
    }

    async getCards(pack, language) {
        const apiUrl = 'https://archonarcana.com/api.php?action=cargoquery&format=json&tables=SpoilerData&' + 
                       'fields=SpoilerData.Power,SpoilerData.Rarity,SpoilerData.Name,SpoilerData.House,SpoilerData.Type,SpoilerData.Image,SpoilerData.CardNumber,' + 
                       'SpoilerData.SearchText,SpoilerData.SearchFlavorText,SpoilerData.Traits,SpoilerData.Armor,SpoilerData.IsNew,SpoilerData.Source,' +
                       'SpoilerData.Amber&group_by=SpoilerData.Power,SpoilerData.Rarity,SpoilerData.Name,SpoilerData.House,' +
                       'SpoilerData.Type,SpoilerData.Image,SpoilerData.CardNumber,SpoilerData.SearchText,SpoilerData.SearchFlavorText,SpoilerData.Traits,' +
                       'SpoilerData.Armor,SpoilerData.IsNew,SpoilerData.Source,SpoilerData.Amber&limit=200&offset=0&order_by=CardNumber';

        let packCardMap = pack.cards.reduce(function(map, obj) {
            map[obj.number] = obj;
            return map;
        }, {});

        let response;
        let cards = {};

        let responseReceived = false;

        while(!responseReceived) {
            try {
                response = await httpRequest(`${apiUrl}`, { json: true });
                responseReceived = true;
            } catch(err) {
                console.info(err);

                return;
            }
        }        
        
        let generatedNumber = 900;
        let generatedNumberCards = {
        };
        for(let el of response.cargoquery) {
            let card = el.title;
            
            if(!card.CardNumber) {
                generatedNumberCards[card.cardTitle] = generatedNumberCards[card.cardTitle] || ++generatedNumber;
                card.CardNumber = generatedNumberCards[card.cardTitle];
            }
            
            card.CardNumber = card.CardNumber.replace('~', '');

            /*
            if(!pack.ids.includes('' + card.expansion) || cards[card.cardNumber] || card.maverick) {
                console.log('Ignoring card: ', card.cardTitle, card.expansion, card.cardNumber, card.maverick);
                continue;
            }
            */
            
            if(card.CardNumber === '000') {
                console.log('Ignoring scenario card: ', card.Name);
                continue;
            }

            if(card.IsNew !== 'yes') {
                console.log('Ignoring reprinted card: ', card.Name);
                continue;
            }

            // Fix the house of an anomaly to brobnar so that we can test them until they get a real house
            if(card.anomaly) { // TODO
                card.house = 'brobnar';
            }

            let newCard = null;
            
            if(language === 'en') {
                let cardText = card.SearchText.replace(/&lt;.+?&gt;/gi, '');
                newCard = {
                    id: card.Name.toLowerCase().replace(/[?.!",“”]/gi, '').replace(/[ '’]/gi, '-').replace('-(evil-twin)', '-evil-twin').replace('-()', ''),
                    name: card.Name,
                    number: card.CardNumber,
                    image: card.Image,
                    //expansion: card.expansion,
                    house: card.House.toLowerCase().replace(' ', ''),
                    keywords: this.parseKeywords(card.SearchText),
                    traits: !card.Traits ? [] : card.Traits.split(' • ').map(trait => trait.toLowerCase()),
                    type: card.Type.toLowerCase(),
                    rarity: card.Rarity,
                    amber: card.Amber === '' ? 0 : parseInt(card.Amber),
                    armor: card.Type.toLowerCase() === 'creature' ? (card.Armor !== '' ? parseInt(card.Armor) : 0) : null,
                    power: card.Power === '' ? null : parseInt(card.Power),
                    text: cardText,
                    locale: {
                        'en': {
                            name: card.Name.replace(' (Evil Twin)', '')
                        }
                    }
                };
            } else {
                // Append locale information
                newCard = packCardMap[card.cardNumber];

                if(!newCard.locale) {
                    // Just a safe check, but since 'en' is supposed to be loaded first, locale
                    // will already exist
                    newCard.locale = [];
                }

                newCard.locale[language.replace('-', '')] = {
                    name: card.cardTitle
                };

            };

            // Sort locale by key
            newCard.locale = Object.keys(newCard.locale).sort().reduce((newLocale, currentValue) => {
                newLocale[currentValue] = newCard.locale[currentValue];
                return newLocale;
            }, {});

            cards[card.CardNumber] = newCard;            
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

module.exports = DecksOfKeyforgeApiToKeytekiConverter;
