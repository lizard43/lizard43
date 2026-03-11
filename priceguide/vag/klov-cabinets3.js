#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const INPUT = process.argv[2];
const OUTPUT = process.argv[3] || "output.json";
const IMAGE_DIR = "images";

if (!INPUT) {
    console.log("Usage:");
    console.log("./klov-cabinets3.js input.json output.json");
    process.exit(1);
}

if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function yearOnly(dateStr) {
    if (!dateStr) return null;
    const m = String(dateStr).match(/\d{4}/);
    return m ? m[0] : null;
}

function normalize(s) {
    return String(s || "").toLowerCase().trim();
}

async function fetch(url) {
    const res = await axios.get(url, {
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/120 Safari/537.36"
        }
    });
    return res.data;
}

async function downloadImage(url, filename) {
    const res = await axios.get(url, { responseType: "arraybuffer" });
    fs.writeFileSync(filename, res.data);
}

function parseRatings($) {
    const ratings = {
        user: null,
        fun: null,
        collector: null,
        technical: null
    };

    $(".progress-bar").each((i, el) => {
        const title = $(el).attr("title") || "";
        const val = parseInt(title.replace("%", ""));
        if (!isNaN(val)) {
            if (ratings.user === null) ratings.user = val;
            else if (ratings.fun === null) ratings.fun = val;
            else if (ratings.collector === null) ratings.collector = val;
            else if (ratings.technical === null) ratings.technical = val;
        }
    });

    return ratings;
}

async function processEntry(entry) {
    if (entry.klov && entry.klov !== "") {
        console.log(`skip: ${entry.title} (klov already set)`);
        return entry;
    }

    const title = entry.title;
    const manufacturer = normalize(entry.manufacturer);
    const year = yearOnly(entry.date);

    const searchUrl =
        "https://www.arcade-museum.com/searchResults?q=" +
        encodeURIComponent(title);

    console.log("  Searching:", title);
    const html = await fetch(searchUrl);
    const $ = cheerio.load(html);

    const rows = $("#games tbody tr");

    let matchUrl = null;

    rows.each((i, row) => {
        const cols = $(row).find("td");

        const name = normalize($(cols[0]).text());
        const dev = normalize($(cols[1]).text());
        const yr = $(cols[2]).text().trim();

        if (dev.includes(manufacturer) && yr === year) {
            const href = $(cols[0]).find("a").attr("href");
            if (href) {
                matchUrl = href;
                return false;
            }
        }
    });

    if (!matchUrl) {
        console.log("  no match");
        return entry;
    }

    console.log("  match:", matchUrl);

    entry.klov = matchUrl;

    const detailHtml = await fetch(matchUrl);
    const $$ = cheerio.load(detailHtml);

    const ratings = parseRatings($$);

    entry.ratings = ratings;

    $$("figure").each((i, fig) => {
        const cap = $$(fig).find("figcaption").text().toLowerCase();

        if (cap.includes("cabinet")) {
            const img = $$(fig).find("img").attr("src");

            if (img) {
                const url = img.startsWith("http")
                    ? img
                    : "https://www.arcade-museum.com" + img;

                const fname =
                    title.replace(/[^a-z0-9]/gi, "_").toLowerCase() + ".jpg";

                const file = path.join(IMAGE_DIR, fname);

                console.log("  downloading image");

                return downloadImage(url, file).then(() => {
                    entry.image = fname;
                });
            }
        }
    });

    return entry;
}

async function main() {
    const data = JSON.parse(fs.readFileSync(INPUT, "utf8"));

    console.log(`Loaded ${data.length} entries from ${INPUT}`);

    for (let i = 0; i < data.length; i++) {
        const entry = data[i];
        const title = entry && entry.title ? entry.title : "(untitled)";

        process.stdout.write(`[${i + 1}/${data.length}] ${title} ... `);

        try {
            console.log(`[${i+1}/${data.length}] ${entry.title}`);
            
            if (entry.klov && entry.klov !== "") {
                console.log("skip (klov already set)");
                continue;
            }

            console.log("searching");
            data[i] = await processEntry(entry);

            fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
            await sleep(1200);
        } catch (e) {
            console.log(`error: ${e.message}`);
        }
    }

    console.log("Done.");
}

main();