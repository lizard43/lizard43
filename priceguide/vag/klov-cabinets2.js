#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (!process.argv[i].startsWith("--")) continue;
    const key = process.argv[i].substring(2);
    const val = process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
      ? process.argv[++i]
      : true;
    args[key] = val;
  }
  return args;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normalize(s) {
  return String(s || "").trim();
}

function pageImage(name) {
  return /^page_\d+\.jpg$/i.test(name);
}

function slug(title) {
  return String(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function absolute(base, href) {
  try { return new URL(href, base).toString(); }
  catch { return null; }
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept": "text/html"
    }
  });
  return {
    html: await res.text(),
    finalUrl: res.url
  };
}

function findCabinet(html, base) {
  const $ = cheerio.load(html);

  for (const fig of $("figure").toArray()) {
    const $fig = $(fig);
    const cap = normalize($fig.find("figcaption").text()).toLowerCase();

    if (cap !== "cabinet") continue;

    const img = $fig.find("img").first();
    if (!img.length) continue;

    const src = img.attr("data-src") || img.attr("src");
    if (!src) continue;

    return absolute(base, src);
  }

  return null;
}

async function download(url, file) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, buf);
}

function write(out, data) {
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
}

async function main() {

  const args = parseArgs();

  if (!args.in || !args.out) {
    console.log("usage: script --in file.json --out file.json --dir images");
    process.exit(1);
  }

  const dir = args.dir || "images";

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const data = JSON.parse(fs.readFileSync(args.in));

  for (let i = 0; i < data.length; i++) {

    const g = data[i];

    if (!pageImage(g.image)) continue;
    if (!g.klov) continue;

    console.log(`checking ${g.title}`);

    try {

      const { html, finalUrl } = await fetchHtml(g.klov);

      const img = findCabinet(html, finalUrl);

      if (!img) {
        console.log("  no cabinet image");
        continue;
      }

      const filename = `${slug(g.title)}_cabinet.jpg`;
      const filepath = path.join(dir, filename);

      if (!fs.existsSync(filepath)) {
        await download(img, filepath);
        console.log("  downloaded", filename);
      }

      g.image = filename;

    } catch (e) {
      console.log("  error:", e.message);
    }

    write(args.out, data);

    await sleep(1200);
  }

  write(args.out, data);
}

main();