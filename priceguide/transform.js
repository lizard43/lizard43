#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function usage() {
  console.error(`Usage:
  node transform.js input.json [output.json]

Notes:
  - input.json should be an array of objects
  - output.json defaults to input.transformed.json`);
  process.exit(2);
}

function extractPageFromImage(image) {
  if (typeof image !== 'string') return null;

  // Typical: "page_151.jpg"
  let m = image.match(/(?:^|\/)page_(\d+)\.(?:jpg|jpeg|png|webp)$/i);
  if (m) return Number(m[1]);

  // Fallback: any digits in filename
  m = path.basename(image).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function splitTypes(typeField) {
  if (typeof typeField !== 'string') return [];
  // Split on commas; trim; drop empties
  return typeField
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function transformEntry(entry) {
  const out = { ...entry };

  // 1) Add page from image
  out.page = extractPageFromImage(out.image);

  // 2) Move prices into variants per type
  const types = splitTypes(out.type);
  const price_lower = toNumberOrNull(out.price_lower);
  const price_average = toNumberOrNull(out.price_average);
  const price_higher = toNumberOrNull(out.price_higher);

  out.variant = (types.length ? types : [out.type].filter(Boolean)).map(t => ({
    type: t,
    price_lower,
    price_average,
    price_higher,
  }));

  // 3) Remove top-level type and prices
  delete out.type;
  delete out.price_lower;
  delete out.price_average;
  delete out.price_higher;

  return out;
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) usage();

  const raw = fs.readFileSync(inputPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse JSON: ${e.message}`);
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error('Expected input JSON to be an array of objects.');
    process.exit(1);
  }

  const transformed = data.map(transformEntry);

  const outPath =
    outputPath ||
    inputPath.replace(/\.json$/i, '') + '.transformed.json';

  fs.writeFileSync(outPath, JSON.stringify(transformed, null, 2) + '\n', 'utf8');

  // Print a tiny summary
  const missingPage = transformed.filter(x => x.page === null).length;
  console.log(`Wrote ${transformed.length} entries -> ${outPath}`);
  if (missingPage) console.log(`Warning: ${missingPage} entries had no page extracted.`);
}

main();
