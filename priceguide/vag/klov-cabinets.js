#!/usr/bin/env node
/**
 * klov_cabinet_image_backfill.js
 *
 * Usage:
 *   node klov_cabinet_image_backfill.js --in input.json --out output.json --dir images
 *
 * Behavior:
 * - Only processes entries where entry.image starts with "page_"
 * - Searches KLOV / Arcade-Museum by title
 * - If ONLY ONE result row exists in <table id="games">, follows it
 * - On the game page, finds figcaption exactly "Cabinet"
 * - Downloads the cabinet image and updates entry.image to local filename
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const cheerio = require("cheerio");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeFilename(name) {
  // Keep it simple and filesystem-friendly
  return String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function getUrlBasename(urlStr) {
  try {
    const u = new URL(urlStr);
    const base = path.basename(u.pathname);
    return base || "image.jpg";
  } catch {
    return "image.jpg";
  }
}

async function fetchText(url, { userAgent } = {}) {
  const res = await fetch(url, {
    headers: {
      "user-agent": userAgent || "Mozilla/5.0 (Node.js script) KLOV image backfill",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function fetchBinary(url, { userAgent } = {}) {
  const res = await fetch(url, {
    headers: {
      "user-agent": userAgent || "Mozilla/5.0 (Node.js script) KLOV image backfill",
      "accept": "*/*",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function absoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

/**
 * From the search results page:
 * - Find <table id="games">
 * - Count data rows (tbody tr) or (all tr minus a single header row)
 * - If exactly 1 data row, return the first row / first column link URL
 */
function extractSingleResultUrl(searchHtml, searchUrl) {
  const $ = cheerio.load(searchHtml);
  const table = $("#games");
  if (!table.length) return { url: null, reason: "no #games table" };

  // Prefer tbody rows if present, else fallback to all rows
  let rows = table.find("tbody tr");
  if (!rows.length) rows = table.find("tr");

  // Filter out header-ish rows (th cells)
  const dataRows = rows
    .toArray()
    .map((tr) => $(tr))
    .filter(($tr) => $tr.find("td").length > 0);

  if (dataRows.length !== 1) {
    return { url: null, reason: `expected 1 result row, got ${dataRows.length}` };
  }

  const $row = dataRows[0];
  const firstCellLink = $row.find("td").first().find("a[href]").first();
  const href = firstCellLink.attr("href");
  if (!href) return { url: null, reason: "no link in first cell" };

  const full = absoluteUrl(searchUrl, href);
  return { url: full, reason: null };
}

/**
 * On the game page:
 * - First look for a <figure> whose <figcaption> direct text is exactly "Cabinet"
 * - If not found, fall back to a figcaption of exactly "Flyer"
 * - Image URL preference:
 *   1) <figcaption img[data-src]>
 *   2) <figcaption img[src]>
 *   3) fallback: any <img> inside the same <figure>
 */
function extractPreferredImageUrl(gameHtml, gameUrl) {
  const $ = cheerio.load(gameHtml);
  const figures = $("figure").toArray().map((f) => $(f));

  function findByCaption(captionText) {
    for (const $fig of figures) {
      const $cap = $fig.find("figcaption").first();
      if (!$cap.length) continue;

      const directText = $cap
        .contents()
        .toArray()
        .filter((n) => n.type === "text")
        .map((n) => normalizeText(n.data))
        .join(" ")
        .trim();

      if (directText !== captionText) continue;

      const $imgInCap = $cap.find("img").first();
      let src = $imgInCap.attr("data-src") || $imgInCap.attr("src");

      if (!src) {
        const $imgInFig = $fig.find("img").first();
        src = $imgInFig.attr("data-src") || $imgInFig.attr("src");
      }

      if (!src) {
        return { url: null, reason: `${captionText} figure found but no img src/data-src` };
      }

      return {
        url: absoluteUrl(gameUrl, src),
        reason: null,
        kind: captionText,
      };
    }

    return { url: null, reason: `no ${captionText} figcaption found`, kind: captionText };
  }

  const cabinet = findByCaption("Cabinet");
  if (cabinet.url) return cabinet;

  const flyer = findByCaption("Flyer");
  if (flyer.url) return flyer;

  return {
    url: null,
    reason: `no Cabinet or Flyer figcaption found`,
    kind: null,
  };
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function downloadToDir(imgUrl, outDir, { prefix } = {}) {
  await ensureDir(outDir);

  const base = getUrlBasename(imgUrl);
  const safeBase = safeFilename(base);

  // Optional prefix to avoid collisions and help trace origin
  const finalName = prefix ? `${safeFilename(prefix)}_${safeBase}` : safeBase;
  const outPath = path.join(outDir, finalName);

  // If already exists, don't redownload
  if (fs.existsSync(outPath)) {
    return { filename: finalName, reused: true };
  }

  const bin = await fetchBinary(imgUrl);
  await fsp.writeFile(outPath, bin);
  return { filename: finalName, reused: false };
}

async function main() {
  const args = parseArgs(process.argv);

  const inFile = args.in || args.input;
  const outFile = args.out || args.output || "out.json";
  const imgDir = args.dir || "images";
  const delayMs = Number(args.delay || 2000); // be polite
  const max = args.max ? Number(args.max) : Infinity;

  if (!inFile) {
    console.error("Missing --in input.json");
    process.exit(2);
  }

  const raw = await fsp.readFile(inFile, "utf8");
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (e) {
    console.error("Input is not valid JSON:", e.message);
    process.exit(2);
  }

  if (!Array.isArray(entries)) {
    console.error("Input JSON must be an array of entries.");
    process.exit(2);
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const title = String(entry?.title || "").trim();
    const image = String(entry?.image || "");

    if (!title) {
      skipped++;
      continue;
    }

    if (!image.startsWith("page_")) {
      skipped++;
      continue;
    }

    if (processed >= max) break;
    processed++;

    const searchUrl =
      "https://www.arcade-museum.com/searchResults?q=" +
      encodeURIComponent(title) +
      "&boolean=AND";

    try {
      // 1) search page
      const searchHtml = await fetchText(searchUrl);
      const { url: gameUrl, reason: searchReason } = extractSingleResultUrl(searchHtml, searchUrl);

      if (!gameUrl) {
        // no single match => move on
        // console.log(`[${i}] "${title}" skip: ${searchReason}`);
        await sleep(delayMs);
        continue;
      }

      // 2) game page
      const gameHtml = await fetchText(gameUrl);
      const { url: imageUrl, reason: imgReason, kind } = extractPreferredImageUrl(gameHtml, gameUrl);

      if (!imageUrl) {
        // console.log(`[${i}] "${title}" skip: ${imgReason}`);
        await sleep(delayMs);
        continue;
      }

      const prefix = title;
      const dl = await downloadToDir(imageUrl, imgDir, { prefix });

      // 4) update entry
      entry.image = dl.filename;
      updated++;

      console.log(
        `[${i}] OK "${title}" -> ${dl.filename}${dl.reused ? " (reused)" : ""}${kind ? ` [${kind}]` : ""}`
      );

      await sleep(delayMs);
    } catch (e) {
      errors++;
      console.log(`[${i}] ERROR "${title}": ${e.message}`);
      await sleep(delayMs);
    }
  }

  await fsp.writeFile(outFile, JSON.stringify(entries, null, 2) + "\n", "utf8");

  console.log("\nDone.");
  console.log(`Processed candidates: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (non-page_ or missing title): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Wrote: ${outFile}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});