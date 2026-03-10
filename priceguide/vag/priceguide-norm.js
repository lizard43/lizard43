#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const inputFile = process.argv[2] || "priceguide.json";
const outputFile = process.argv[3] || "priceguide.updated.json";

const DEFAULT_RATINGS = {
  user: null,
  fun: null,
  collector: null,
  technical: null,
};

function normalizeEntry(entry) {
  const updated = { ...entry };

  if (!Object.prototype.hasOwnProperty.call(updated, "klov")) {
    updated.klov = null;
  }

  const ratings = updated.ratings;

  const hasValidRatingsObject =
    ratings &&
    typeof ratings === "object" &&
    !Array.isArray(ratings) &&
    Object.prototype.hasOwnProperty.call(ratings, "user") &&
    Object.prototype.hasOwnProperty.call(ratings, "fun") &&
    Object.prototype.hasOwnProperty.call(ratings, "collector") &&
    Object.prototype.hasOwnProperty.call(ratings, "technical");

  if (!hasValidRatingsObject) {
    updated.ratings = { ...DEFAULT_RATINGS };
  }

  return updated;
}

function main() {
  const inputPath = path.resolve(inputFile);
  const outputPath = path.resolve(outputFile);

  let data;
  try {
    data = fs.readFileSync(inputPath, "utf8");
  } catch (err) {
    console.error(`Failed to read input file: ${inputPath}`);
    console.error(err.message);
    process.exit(1);
  }

  let json;
  try {
    json = JSON.parse(data);
  } catch (err) {
    console.error(`Failed to parse JSON from: ${inputPath}`);
    console.error(err.message);
    process.exit(1);
  }

  if (!Array.isArray(json)) {
    console.error("Expected top-level JSON to be an array.");
    process.exit(1);
  }

  const updatedJson = json.map(normalizeEntry);

  try {
    fs.writeFileSync(outputPath, JSON.stringify(updatedJson, null, 2) + "\n", "utf8");
  } catch (err) {
    console.error(`Failed to write output file: ${outputPath}`);
    console.error(err.message);
    process.exit(1);
  }

  console.log(`Processed ${updatedJson.length} entries.`);
  console.log(`Wrote updated file to: ${outputPath}`);
}

main();