#!/usr/bin/env node

const fs = require("fs");

function usage() {
  console.error("Usage: node filter-distance.js <input.json> <maxDistance>");
  process.exit(1);
}

const inputPath = process.argv[2];
const maxArg = Number(process.argv[3]);

if (!inputPath || !Number.isFinite(maxArg)) {
  usage();
}

try {
  const raw = fs.readFileSync(inputPath, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("Input JSON must be an array.");
  }

  const filtered = data.filter(v => {
    if (v.distance === null || v.distance === undefined) return false;

    const d = Number(v.distance);
    return Number.isFinite(d) && d < maxArg;
  });

  process.stdout.write(JSON.stringify(filtered, null, 2));
  process.stderr.write(
    `\nFiltered ${filtered.length} of ${data.length} records with distance < ${maxArg}\n`
  );

} catch (err) {
  console.error("Error:", err.message);
  process.exit(1);
}