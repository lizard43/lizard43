#!/usr/bin/env node

const fs = require("fs");

if (process.argv.length < 4) {
  console.log("Usage: node add-id.js input.json output.json");
  process.exit(1);
}

const inputFile = process.argv[2];
const outputFile = process.argv[3];

try {
  const data = JSON.parse(fs.readFileSync(inputFile, "utf8"));

  if (!Array.isArray(data)) {
    console.error("Input JSON must be an array");
    process.exit(1);
  }

  let id = 1;

  const result = data.map(entry => {
    return {
      id: `vag-${id++}`,
      ...entry
    };
  });

  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));

  console.log(`Wrote ${result.length} records to ${outputFile}`);
} catch (err) {
  console.error("Error:", err.message);
}