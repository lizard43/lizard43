#!/usr/bin/env node

const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");

const letters = [
  "0","A","B","C","D","E","F","G","H","I","J","K",
  "L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"
];

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
usage:
  klov-game-lists-harvest.js output.json [options]

options:
  --delay <ms>     delay between requests (default 1500)
  --only <letter>  process only one section (example: M)
  --append         append to existing file
  --pretty         pretty JSON output
`);
  process.exit(1);
}

const outputFile = args[0];

let delay = 1500;
let only = null;
let append = false;
let pretty = false;

for (let i = 1; i < args.length; i++) {
  if (args[i] === "--delay") delay = parseInt(args[++i]);
  else if (args[i] === "--only") only = args[++i].toUpperCase();
  else if (args[i] === "--append") append = true;
  else if (args[i] === "--pretty") pretty = true;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const http = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive"
  }
});

let results = [];

if (append && fs.existsSync(outputFile)) {
  results = JSON.parse(fs.readFileSync(outputFile));
}

const seen = new Set(results.map(e => e.klov));

function buildEntry(row) {

  const cells = row.find("td");
  if (cells.length < 5) return null;

  const nameCell = cells.eq(0);
  const devCell = cells.eq(1);
  const yearCell = cells.eq(2);
  const typeCell = cells.eq(3);
  const genreCell = cells.eq(4);

  const link = nameCell.find("a");
  const title = link.text().trim();

  let klov = null;
  if (link.length) {
    const href = link.attr("href");
    if (href) {
      if (href.startsWith("http")) klov = href;
      else klov = "https://www.arcade-museum.com" + href;
    }
  }

  if (!title || !klov) return null;

  if (seen.has(klov)) return null;
  seen.add(klov);

  return {
    image: null,
    title: title,
    manufacturer: devCell.text().trim() || null,
    date: yearCell.text().trim() || null,
    type: typeCell.text().trim() || null,
    genre: genreCell.text().trim() || null,
    page: null,
    variant: [],
    klov: klov,
    ratings: {
      user: null,
      fun: null,
      collector: null,
      technical: null
    }
  };
}

async function harvestPage(url) {

  console.log("fetch:", url);

  const res = await http.get(url);
  const $ = cheerio.load(res.data);

  const rows = $("#games tbody tr");

  const found = [];

  rows.each((i, el) => {
    const entry = buildEntry($(el));
    if (entry) found.push(entry);
  });

  console.log("  rows:", found.length);

  return { $, found };
}

async function processLetter(letter) {

  let pageUrl = `https://www.arcade-museum.com/game-list/${letter}/All`;

  while (pageUrl) {

    const { $, found } = await harvestPage(pageUrl);

    results.push(...found);

    const next = $("a[rel='next']").attr("href");

    if (next) {
      pageUrl = next.startsWith("http")
        ? next
        : "https://www.arcade-museum.com" + next;
      await sleep(delay);
    } else {
      pageUrl = null;
    }
  }
}

(async () => {

  const sections = only ? [only] : letters;

  for (const letter of sections) {
    console.log("\n=== Section", letter, "===\n");

    try {
      await processLetter(letter);
    } catch (err) {
      console.log("error:", err.message);
    }

    await sleep(delay);
  }

  fs.writeFileSync(
    outputFile,
    JSON.stringify(results, null, pretty ? 2 : 0)
  );

  console.log("\nDone.");
  console.log("Entries:", results.length);
})();