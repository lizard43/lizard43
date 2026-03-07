#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const JSON_FILE = process.argv[2] || path.join(__dirname, "vagal_ups2.json");

// How big a page jump should count as suspicious?
// Example: 319 -> 722 would be flagged.
const MAX_ALLOWED_JUMP = Number(process.argv[3] || 25);

function titleSortKey(title) {
  return String(title || "")
    .trim()
    .replace(/^[^a-z0-9]+/i, "");
}

function loadGames(file) {
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw);

  let arr;
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && Array.isArray(data.games)) {
    arr = data.games;
  } else {
    throw new Error("JSON must be an array or an object with a games array");
  }

  return arr
    .filter(g => g && typeof g === "object")
    .map(g => ({
      title: g.title ?? "",
      manufacturer: g.manufacturer ?? "",
      date: g.date ?? "",
      genre: g.genre ?? "",
      page: Number(g.page),
      image: g.image ?? "",
      variant: Array.isArray(g.variant) ? g.variant : []
    }));
}

function sortGames(games) {
  return games.sort((a, b) => {
    const ta = titleSortKey(a.title);
    const tb = titleSortKey(b.title);

    return ta.localeCompare(tb, undefined, {
      sensitivity: "base",
      numeric: false
    });
  });
}

function findPageAnomalies(games, maxJump) {
  const anomalies = [];

  for (let i = 1; i < games.length; i++) {
    const prev = games[i - 1];
    const curr = games[i];

    if (!Number.isFinite(prev.page) || !Number.isFinite(curr.page)) {
      anomalies.push({
        type: "invalid-page",
        index: i,
        prev,
        curr
      });
      continue;
    }

    const delta = curr.page - prev.page;

    // Flag large forward jumps and any backward jumps.
    if (delta < 0 || delta > maxJump) {
      anomalies.push({
        type: delta < 0 ? "page-went-backwards" : "large-page-jump",
        index: i,
        delta,
        prev,
        curr
      });
    }
  }

  return anomalies;
}

function main() {
  const games = sortGames(loadGames(JSON_FILE));
  const anomalies = findPageAnomalies(games, MAX_ALLOWED_JUMP);

  console.log(`Loaded: ${games.length} games`);
  console.log(`Threshold: ${MAX_ALLOWED_JUMP}`);
  console.log("");

  if (!anomalies.length) {
    console.log("No page anomalies found.");
    return;
  }

  console.log(`Found ${anomalies.length} suspicious page transitions:\n`);

  for (const a of anomalies) {
    const prev = a.prev;
    const curr = a.curr;

    console.log(
      `[${a.index}] ${a.type}` +
      (typeof a.delta === "number" ? ` (delta ${a.delta >= 0 ? "+" : ""}${a.delta})` : "")
    );
    console.log(`  prev: "${prev.title}"  page=${prev.page}`);
    console.log(`  curr: "${curr.title}"  page=${curr.page}`);
    console.log("");
  }
}

main();