const fs = require("fs");
const { JSDOM } = require("jsdom");
const { PokemonTCG } = require('../pokemon-tcg-sdk-typescript/dist')

const BASE_URI = "https://bulbapedia.bulbagarden.net";

const getThemeDeckList = async () => {
    const decks = {};
    const { document } = (await JSDOM.fromURL(`${BASE_URI}/wiki/Theme_Deck_(TCG)`)).window;
    const generations = document.querySelectorAll('table.multicol:nth-child(6)>tbody>tr>td');

    for (const g of generations) {
        let currentSet = "";
        for (const child of g.children) {
            if (child.tagName === "H2") break;
            switch (child.tagName) {
                case "P":
                    const link = child.querySelector('b>a');
                    currentSet = link ? link.innerHTML : "";
                    break;
                case "UL":
                    const setDecks = child.querySelectorAll('li');
                    for (const d of setDecks) {
                        const deck = d.querySelectorAll('a')[0];
                        if (!deck) continue;

                        const types = Array.from(d.querySelectorAll('a')).slice(1).map(t => t.getAttribute('title').toLowerCase());
                        const name = deck.getAttribute('title').replace(" (TCG)", "");
                        const link = `${BASE_URI}${deck.getAttribute('href')}`
                        if (!decks[currentSet]) decks[currentSet] = [];
                        decks[currentSet].push({ name, link, types })
                    }
                    break;
            }
        }
    }
    return decks;
}

const extractCardData = (row) => {
    const card = {};
    card.count = parseInt(row.children[0].innerHTML);
    card.name = row.children[1].textContent.trim();

    const title = row.children[1].children[0].getAttribute('title');
    card.set = title.slice(title.indexOf('(') + 1, title.lastIndexOf(" "));
    card.index = title.slice(title.lastIndexOf(" ") + 1, -1);
    if (row.children[3].children[0])
        card.rarity = row.children[3].children[0].getAttribute('title');

    return card;
}

const getDeck = async (url) => {
    const { document } = (await JSDOM.fromURL(url)).window
    const cardListHeading = document.querySelector('#Deck_list') || document.querySelector("#Cards")
    const cardList = Array.from(cardListHeading.parentElement.nextElementSibling.querySelectorAll("tr")).slice(1, -1);

    const cards = []
    for (const row of cardList) {
        cards.push(extractCardData(row));
    }

    return cards;
}

const fetchAllDecks = async () => {
    const deckList = await getThemeDeckList();

    for (const [set, decks] of Object.entries(deckList)) {
        console.log(set);
        for (let [index, deck] of decks.entries()) {
            try {
                console.log(deck.name);
                const deckData = await getDeck(deck.link)
                deck.cards = deckData;
                decks[index] = deck;
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (e) {
                console.error(e);
            }
        }
        fs.writeFileSync(`./decks/${set}.json`, JSON.stringify(decks, null, 4));
    }
}

const mapDataToAPI = async () => {
    const sets = await PokemonTCG.Set.all();
    const setCodes = new Map(sets.map(s => [s.name, s.code]));

    const setFiles = await fs.promises.readdir('./decks-raw');
    for (const f of setFiles) {
        try {
            const decks = require(`./decks-raw/${f}`)
            const setName = f.split(".json")[0];
            console.log(setName);
            for (const [d_i, d] of Object.entries(decks)) {
                const deckSet = setCodes.get(setName);
                if(deckSet) decks[d_i].id = `d-${deckSet}-${parseInt(d_i)+1}`;
                for (const [c_i, c] of Object.entries(d.cards)) {
                    c.index = parseInt(c.index);
                    if(c.set && c.index) {
                        const cardSet = setCodes.get(c.set.replace("EX ", ""))
                        if(cardSet) {
                            d.cards[c_i].id = `${cardSet}-${c.index}`
                            delete d.cards[c_i].set;
                            delete d.cards[c_i].index;
                        }
                    }
                    else {
                        const latestCode = setCodes.get(setName);

                        const getCard = async function (setCode, name) {
                            const possibleCard = await PokemonTCG.Card.where([
                                { name: "setCode", value: setCode },
                                { name: "name", value: name }
                            ]);
                            if (possibleCard.length === 0) {
                                const setIndex = sets.findIndex(s => s.code === setCode);
                                const nextCode = sets[setIndex - 1].code;
                                return getCard(nextCode, name);
                            }
                            else return possibleCard[0];
                        }
                        const card = await getCard(latestCode, c.name);
                        if (!card) {
                            console.log(`Cannot find a match for ${setName} / ${d.name} / ${c.name}`)
                        }
                        else {
                            d.cards[c_i].id = card.id
                            delete d.cards[c_i].set;
                            delete d.cards[c_i].index;
                        }
                    }
                    if(!d.cards[c_i].id) console.log(`Could not ID ${setName} / ${d.name} / ${c.name}`)
                }
            }
            fs.writeFileSync(`./decks-parsed/${f}`, JSON.stringify(decks, null, 4));
        } catch (e) {
            console.error(`Error writing ${f}`)
            console.error(e);
        }
    }
}

(async () => {
    // const sets = await fs.promises.readdir("./decks")

    // for(const f of sets) {
    //     const set = require(`./decks/${f}`);
    //     for(const [i,d] of Object.entries(set)) {
    //         const { id, name, types, cards } = d;
    //         for(const [c_i, c] of Object.entries(cards)) {
    //             const { id, name, rarity, count } = c;
    //             cards[c_i] = { id, name, rarity, count };
    //         }
    //         set[i] = { id, name, types, cards }
    //     }
    //     await fs.promises.writeFile(`./decks2/${f}`, JSON.stringify(set, null, 4));
    // }
})()
