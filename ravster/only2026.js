#!/usr/bin/env node

const fs = require("fs");

function usage() {
  console.error("Usage: node filter-year.js <input.json> [year]");
  process.exit(1);
}

const inputPath = process.argv[2];
const yearArg = process.argv[3] ? Number(process.argv[3]) : 2026;

if (!inputPath) usage();

if (!Number.isFinite(yearArg)) {
  console.error("Invalid year.");
  process.exit(1);
}

try {
  const raw = fs.readFileSync(inputPath, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("Input JSON must be an array.");
  }

  const filtered = data.filter(v => Number(v.year) === yearArg);

  process.stdout.write(JSON.stringify(filtered, null, 2));
  process.stderr.write(
    `\nFiltered ${filtered.length} of ${data.length} records for year ${yearArg}\n`
  );

} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
}