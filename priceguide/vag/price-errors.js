#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const inputFile = process.argv[2] || "vagal_ups.json";

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function fmtPrice(v) {
  return isFiniteNumber(v) ? `$${v.toLocaleString()}` : String(v);
}

function printIssue(type, game, variant, details) {
  const title = game.title || "(no title)";
  const variantType = variant?.type || "(no variant type)";
  const page = game.page ?? "?";
  console.log(
    `[${type}] Page ${page} | ${title} | ${variantType} | ${details}`
  );
}

function main() {
  const fullPath = path.resolve(inputFile);

  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (err) {
    console.error(`Failed to parse JSON: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error("Expected top-level JSON array.");
    process.exit(1);
  }

  let totalGames = 0;
  let totalVariants = 0;
  let totalIssues = 0;

  const counts = {
    missingVariantArray: 0,
    missingPrice: 0,
    nonNumericPrice: 0,
    zeroPrice: 0,
    negativePrice: 0,
    avgLessThanLow: 0,
    highLessThanAvg: 0,
    highLessThanLow: 0,
    emptyTitle: 0,
    emptyVariantType: 0,
    duplicateVariantTypeWithinGame: 0,
  };

  for (const game of data) {
    totalGames++;

    if (!game.title || !String(game.title).trim()) {
      counts.emptyTitle++;
      totalIssues++;
      printIssue("EMPTY_TITLE", game, null, "title is blank");
    }

    if (!Array.isArray(game.variant)) {
      counts.missingVariantArray++;
      totalIssues++;
      printIssue("MISSING_VARIANT_ARRAY", game, null, "variant is not an array");
      continue;
    }

    const seenVariantTypes = new Set();

    for (const variant of game.variant) {
      totalVariants++;

      const type = String(variant?.type || "").trim();
      const low = variant?.price_lower;
      const avg = variant?.price_average;
      const high = variant?.price_higher;

      if (!type) {
        counts.emptyVariantType++;
        totalIssues++;
        printIssue("EMPTY_VARIANT_TYPE", game, variant, "variant type is blank");
      } else {
        const key = type.toLowerCase();
        if (seenVariantTypes.has(key)) {
          counts.duplicateVariantTypeWithinGame++;
          totalIssues++;
          printIssue(
            "DUPLICATE_VARIANT_TYPE",
            game,
            variant,
            `duplicate variant type within game: "${type}"`
          );
        }
        seenVariantTypes.add(key);
      }

      for (const [fieldName, value] of [
        ["price_lower", low],
        ["price_average", avg],
        ["price_higher", high],
      ]) {
        if (value === null || value === undefined) {
          counts.missingPrice++;
          totalIssues++;
          printIssue(
            "MISSING_PRICE",
            game,
            variant,
            `${fieldName} is ${value}`
          );
          continue;
        }

        if (!isFiniteNumber(value)) {
          counts.nonNumericPrice++;
          totalIssues++;
          printIssue(
            "NON_NUMERIC_PRICE",
            game,
            variant,
            `${fieldName} = ${JSON.stringify(value)}`
          );
          continue;
        }

        if (value === 0) {
          counts.zeroPrice++;
          totalIssues++;
          printIssue(
            "ZERO_PRICE",
            game,
            variant,
            `${fieldName} = ${fmtPrice(value)}`
          );
        }

        if (value < 0) {
          counts.negativePrice++;
          totalIssues++;
          printIssue(
            "NEGATIVE_PRICE",
            game,
            variant,
            `${fieldName} = ${fmtPrice(value)}`
          );
        }
      }

      if (isFiniteNumber(low) && isFiniteNumber(avg) && avg < low) {
        counts.avgLessThanLow++;
        totalIssues++;
        printIssue(
          "AVG_LT_LOW",
          game,
          variant,
          `low=${fmtPrice(low)}, avg=${fmtPrice(avg)}, high=${fmtPrice(high)}`
        );
      }

      if (isFiniteNumber(avg) && isFiniteNumber(high) && high < avg) {
        counts.highLessThanAvg++;
        totalIssues++;
        printIssue(
          "HIGH_LT_AVG",
          game,
          variant,
          `low=${fmtPrice(low)}, avg=${fmtPrice(avg)}, high=${fmtPrice(high)}`
        );
      }

      if (isFiniteNumber(low) && isFiniteNumber(high) && high < low) {
        counts.highLessThanLow++;
        totalIssues++;
        printIssue(
          "HIGH_LT_LOW",
          game,
          variant,
          `low=${fmtPrice(low)}, avg=${fmtPrice(avg)}, high=${fmtPrice(high)}`
        );
      }
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Games scanned:    ${totalGames}`);
  console.log(`Variants scanned: ${totalVariants}`);
  console.log(`Issues found:     ${totalIssues}`);
  console.log("");

  // for (const [key, value] of Object.entries(counts)) {
  //   console.log(`${key}: ${value}`);
  // }
}

main();