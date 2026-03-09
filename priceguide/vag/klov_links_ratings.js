#!/usr/bin/env node
/**
 * klov_cabinet_info.js
 *
 * Usage:
 *   node klov_links_ratings.js --in input.json --out output.json
 *   node klov_links_ratings.js --in input.json --out output.json --delay 3000 --jitter 1000 --retries 5
 *
 * Optional:
 *   --delay 2500          Base delay between requests in ms
 *   --jitter 750          Random extra delay in ms
 *   --max 100             Process at most N entries
 *   --retries 4           Retry count for rate-limit / transient errors
 *   --timeout 30000       Request timeout in ms
 *
 * Behavior:
 * - Processes all entries
 * - Preserves every existing entry object exactly as-is
 * - Searches KLOV / Arcade-Museum by title
 * - If ONLY ONE result row exists in <table id="games">:
 *      - adds entry.klov
 *      - follows it
 * - On the game page parses <section id="rating">
 * - Adds entry.ratings:
 *      ratings.user
 *      ratings.fun
 *      ratings.collector
 *      ratings.technical
 */

const fs = require("fs");
const cheerio = require("cheerio");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val =
        argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function toNumber(value) {
  const n = parseFloat(String(value || "").trim());
  return Number.isFinite(n) ? n : undefined;
}

function randomInt(max) {
  return Math.floor(Math.random() * Math.max(0, max));
}

async function sleepWithJitter(baseMs, jitterMs) {
  const extra = jitterMs > 0 ? randomInt(jitterMs + 1) : 0;
  await sleep(baseMs + extra);
}

async function fetchText(url, options = {}) {
  const {
    timeoutMs = 30000,
    retries = 4,
    baseDelayMs = 2500,
    jitterMs = 750,
  } = options;

  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
        redirect: "follow",
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.ok) {
        return await res.text();
      }

      const retryAfter = res.headers.get("retry-after");
      const retryable =
        res.status === 429 || (res.status >= 500 && res.status <= 599);

      if (!retryable || attempt === retries) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }

      let waitMs;
      if (retryAfter && /^\d+$/.test(retryAfter)) {
        waitMs = parseInt(retryAfter, 10) * 1000;
      } else {
        waitMs = baseDelayMs * Math.pow(2, attempt) + randomInt(jitterMs + 1);
      }

      console.warn(
        `Retryable response ${res.status} for ${url}. Waiting ${waitMs} ms before retry ${attempt + 1}/${retries}.`
      );
      await sleep(waitMs);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;

      const isAbort = err && (err.name === "AbortError" || /aborted/i.test(err.message));
      const canRetry = attempt < retries;

      if (!canRetry) break;

      const waitMs =
        baseDelayMs * Math.pow(2, attempt) + randomInt(jitterMs + 1);

      console.warn(
        `${isAbort ? "Timeout" : "Fetch error"} for ${url}: ${err.message}. ` +
          `Waiting ${waitMs} ms before retry ${attempt + 1}/${retries}.`
      );
      await sleep(waitMs);
    }
  }

  throw lastErr || new Error(`Failed to fetch ${url}`);
}

function extractSingleResultUrl(searchHtml, searchUrl) {
  const $ = cheerio.load(searchHtml);

  const table = $("#games");
  if (!table.length) {
    return { url: null, reason: "no #games table" };
  }

  let rows = table.find("tbody tr");
  if (!rows.length) {
    rows = table.find("tr");
  }

  // Keep only rows that actually look like game result rows with at least one td
  const dataRows = rows.filter((i, el) => $(el).find("td").length > 0);

  if (dataRows.length !== 1) {
    return { url: null, reason: `found ${dataRows.length} result rows` };
  }

  const link = dataRows.first().find("td a").first();
  const href = link.attr("href");

  if (!href) {
    return { url: null, reason: "single row but no href found" };
  }

  return {
    url: absoluteUrl(searchUrl, href),
    reason: null,
  };
}

function extractRatings(html) {
  const $ = cheerio.load(html);
  const section = $("#rating");
  if (!section.length) return null;

  const ratings = {};

  // User score
  const h2 = section.find("h2").first();
  if (h2.length) {
    const userScore = toNumber(h2.find("span.badge").first().text());
    if (userScore !== undefined) ratings.user = userScore;
  }

  // Fun Factor card
  const funHeader = section
    .find("h3")
    .filter((i, el) => normalizeText($(el).text()).startsWith("Fun Factor:"))
    .first();

  if (funHeader.length) {
    const fun = toNumber(funHeader.find("span.badge").first().text());
    if (fun !== undefined) ratings.fun = fun;

    const funCard = funHeader.closest(".card");
    funCard.find("tr").each((i, tr) => {
      const label = normalizeText($(tr).find("th").first().text());
      const value = toNumber($(tr).find("td").first().text());
      if (label === "Collector Desire" && value !== undefined) {
        ratings.collector = value;
      }
    });
  }

  // Technical Rating card
  const techHeader = section
    .find("h3")
    .filter((i, el) =>
      normalizeText($(el).text()).startsWith("Technical Rating:")
    )
    .first();

  if (techHeader.length) {
    const technical = toNumber(techHeader.find("span.badge").first().text());
    if (technical !== undefined) ratings.technical = technical;
  }

  return Object.keys(ratings).length ? ratings : null;
}

function buildSearchUrl(title) {
  return (
    "https://www.arcade-museum.com/searchResults?q=" +
    encodeURIComponent(title) +
    "&boolean=AND"
  );
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.in || !args.out) {
    console.error(
      "Usage: node klov_cabinet_info.js --in input.json --out output.json [--delay 2500 --jitter 750 --max 100 --retries 4 --timeout 30000]"
    );
    process.exit(1);
  }

  const delayMs = Number(args.delay || 2500);
  const jitterMs = Number(args.jitter || 750);
  const max = args.max ? Number(args.max) : Infinity;
  const retries = Number(args.retries || 4);
  const timeoutMs = Number(args.timeout || 30000);

  const raw = fs.readFileSync(args.in, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    console.error("Input JSON must be an array of entry objects.");
    process.exit(1);
  }

  let processed = 0;

  for (let i = 0; i < data.length; i++) {
    const entry = data[i];

    // Preserve the incoming object exactly; only add keys when found
    const title = entry.title || entry.name;
    if (!title) {
      console.warn(`[${i}] Skipping entry with no title/name`);
      continue;
    }

    if (processed >= max) break;
    processed++;

    console.log(`[${i}] Searching: ${title}`);

    const searchUrl = buildSearchUrl(title);

    try {
      const searchHtml = await fetchText(searchUrl, {
        timeoutMs,
        retries,
        baseDelayMs: delayMs,
        jitterMs,
      });

      const { url: gameUrl, reason } = extractSingleResultUrl(searchHtml, searchUrl);

      if (!gameUrl) {
        console.log(`   No unique match: ${reason}`);
        await sleepWithJitter(delayMs, jitterMs);
        continue;
      }

      entry.klov = gameUrl;
      console.log(`   KLOV: ${gameUrl}`);

      await sleepWithJitter(delayMs, jitterMs);

      const gameHtml = await fetchText(gameUrl, {
        timeoutMs,
        retries,
        baseDelayMs: delayMs,
        jitterMs,
      });

      const ratings = extractRatings(gameHtml);
      if (ratings) {
        entry.ratings = ratings;
        console.log(`   Ratings added: ${JSON.stringify(ratings)}`);
      } else {
        console.log(`   No ratings section found`);
      }

      // write progressively so interrupted runs still preserve completed work
      fs.writeFileSync(args.out, JSON.stringify(data, null, 2));

      await sleepWithJitter(delayMs, jitterMs);
    } catch (err) {
      console.error(`   Error processing "${title}": ${err.message}`);
      // keep going; preserve everything else
      fs.writeFileSync(args.out, JSON.stringify(data, null, 2));
      await sleepWithJitter(delayMs, jitterMs);
    }
  }

  fs.writeFileSync(args.out, JSON.stringify(data, null, 2));
  console.log(`\nDone. Output written to ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});