#!/usr/bin/env node
"use strict";

/**
 * fill_klov_from_slug.js
 *
 * Usage:
 *   node fill_klov_from_slug.js --in input.json --out output.json
 *   node fill_klov_from_slug.js --in input.json --out output.json --delay 1500 --jitter 500 --timeout 30000 --retries 4
 *
 * What it does:
 * - Reads a priceguide JSON array
 * - Only processes entries where entry.klov === ""
 * - Builds a slugged KLOV URL:
 *     https://www.arcade-museum.com/Videogame/<slug>
 * - Fetches that page and validates that it looks like a real game page
 * - If valid:
 *     - sets entry.klov to the resolved URL
 *     - extracts ratings from <section id="rating"> when present
 * - Writes progressive updates to the output file as it runs
 *
 * Notes:
 * - Requires Node.js 18+ for global fetch
 * - Requires: npm i cheerio
 */

const fs = require("fs");
const cheerio = require("cheerio");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val =
      argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    args[key] = val;
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(max) {
  return Math.floor(Math.random() * Math.max(0, max));
}

async function sleepWithJitter(baseMs, jitterMs) {
  const extra = jitterMs > 0 ? randomInt(jitterMs + 1) : 0;
  await sleep(baseMs + extra);
}

function normalizeText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const n = parseFloat(String(value || "").trim());
  return Number.isFinite(n) ? n : undefined;
}

function absoluteUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function slugifyTitle(title) {
  return String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")          // drop apostrophes
    .replace(/&/g, " and ")         // keep readable
    .replace(/[^a-z0-9]+/g, "-")    // punctuation/spaces -> dash
    .replace(/^-+|-+$/g, "")        // trim dashes
    .replace(/-+/g, "-");           // collapse dashes
}

function buildVideogameUrl(title) {
  const slug = slugifyTitle(title);
  return `https://www.arcade-museum.com/Videogame/${slug}`;
}

async function fetchResponse(url, options = {}) {
  const {
    timeoutMs = 30000,
    retries = 4,
    baseDelayMs = 1500,
    jitterMs = 500,
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
          "accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          "pragma": "no-cache",
        },
        redirect: "follow",
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.ok) return res;

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

      if (attempt >= retries) break;

      const waitMs =
        baseDelayMs * Math.pow(2, attempt) + randomInt(jitterMs + 1);

      console.warn(
        `Fetch error for ${url}: ${err.message}. Waiting ${waitMs} ms before retry ${attempt + 1}/${retries}.`
      );
      await sleep(waitMs);
    }
  }

  throw lastErr || new Error(`Failed to fetch ${url}`);
}

async function fetchHtml(url, options = {}) {
  const res = await fetchResponse(url, options);
  return {
    finalUrl: res.url || url,
    status: res.status,
    html: await res.text(),
  };
}

function pageLooksLikeGame(html, requestedTitle) {
  const $ = cheerio.load(html);

  const normalizedRequested = normalizeText(requestedTitle).toLowerCase();
  const h1 = normalizeText($("h1").first().text()).toLowerCase();
  const titleTag = normalizeText($("title").first().text()).toLowerCase();

  const hasRating = $("#rating").length > 0;
  const hasGameDetails =
    $("section").filter((i, el) => {
      const id = ($(el).attr("id") || "").toLowerCase();
      return id.includes("game") || id.includes("details");
    }).length > 0;

  const hasBreadcrumbGame =
    $("a, span, li").filter((i, el) => {
      const txt = normalizeText($(el).text()).toLowerCase();
      return txt === "videogame" || txt === "arcade game";
    }).length > 0;

  const titleMatches =
    (h1 && h1.includes(normalizedRequested)) ||
    (titleTag && titleTag.includes(normalizedRequested));

  const obviousMiss =
    /404|not found|page not found|error/i.test(titleTag) ||
    /404|not found|page not found|error/i.test($.root().text().slice(0, 1000));

  if (obviousMiss) {
    return { ok: false, reason: "page looks like 404/not found" };
  }

  if (hasRating || hasGameDetails || hasBreadcrumbGame || titleMatches) {
    return { ok: true, reason: null };
  }

  return { ok: false, reason: "page did not look like a valid game page" };
}

function extractRatings(html) {
  const $ = cheerio.load(html);
  const section = $("#rating");
  if (!section.length) return null;

  const ratings = {};

  const h2 = section.find("h2").first();
  if (h2.length) {
    const userScore = toNumber(h2.find("span.badge").first().text());
    if (userScore !== undefined) ratings.user = userScore;
  }

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

function maybeMergeRatings(entry, newRatings) {
  if (!newRatings) return false;

  const existing =
    entry.ratings && typeof entry.ratings === "object" ? entry.ratings : {};

  const merged = { ...existing, ...newRatings };
  const changed = JSON.stringify(existing) !== JSON.stringify(merged);

  if (changed) {
    entry.ratings = merged;
  }

  return changed;
}

function writeJson(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.in || !args.out) {
    console.error(
      "Usage: node fill_klov_from_slug.js --in input.json --out output.json [--delay 1500 --jitter 500 --timeout 30000 --retries 4 --max 100]"
    );
    process.exit(1);
  }

  const delayMs = Number(args.delay || 1500);
  const jitterMs = Number(args.jitter || 500);
  const timeoutMs = Number(args.timeout || 30000);
  const retries = Number(args.retries || 4);
  const max = args.max ? Number(args.max) : Infinity;

  const raw = fs.readFileSync(args.in, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    console.error("Input JSON must be an array of entry objects.");
    process.exit(1);
  }

  let touched = 0;
  let examined = 0;

  for (let i = 0; i < data.length; i++) {
    if (examined >= max) break;

    const entry = data[i];
    const title = String(entry?.title || entry?.name || "").trim();
    const klov = entry?.klov;

    if (!title) {
      console.warn(`[${i}] Skipping entry with no title/name`);
      continue;
    }

    if (klov !== "") continue;

    examined++;

    const candidateUrl = buildVideogameUrl(title);
    console.log(`[${i}] Trying slug URL for: ${title}`);
    console.log(`     ${candidateUrl}`);

    try {
      const { finalUrl, html } = await fetchHtml(candidateUrl, {
        timeoutMs,
        retries,
        baseDelayMs: delayMs,
        jitterMs,
      });

      const verdict = pageLooksLikeGame(html, title);
      if (!verdict.ok) {
        console.log(`   Not accepted: ${verdict.reason}`);
        writeJson(args.out, data);
        await sleepWithJitter(delayMs, jitterMs);
        continue;
      }

      let changed = false;

      if (entry.klov !== finalUrl) {
        entry.klov = finalUrl;
        changed = true;
        console.log(`   KLOV set: ${finalUrl}`);
      }

      const ratings = extractRatings(html);
      if (ratings) {
        const ratingsChanged = maybeMergeRatings(entry, ratings);
        if (ratingsChanged) {
          changed = true;
          console.log(`   Ratings updated: ${JSON.stringify(entry.ratings)}`);
        } else {
          console.log(`   Ratings present; no change needed`);
        }
      } else {
        console.log(`   No ratings found on page`);
      }

      if (changed) touched++;
      writeJson(args.out, data);
      await sleepWithJitter(delayMs, jitterMs);
    } catch (err) {
      console.error(`   Error processing "${title}": ${err.message}`);
      writeJson(args.out, data);
      await sleepWithJitter(delayMs, jitterMs);
    }
  }

  writeJson(args.out, data);
  console.log(`\nDone. Examined ${examined} blank-klov entries; updated ${touched}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
