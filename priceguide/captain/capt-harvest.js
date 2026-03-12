#!/usr/bin/env node

const fs = require("fs");

const BASE = "https://bid.captainsauctionwarehouse.com";

function parseArgs(argv) {
  const args = {
    catalog: null,
    start: null,
    end: null,
    out: "captains-results.json",
    delay: 1000,
    verbose: false,
    pages: null,
    lotsOnly: false,
    debugDir: "capt-debug"
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--catalog") args.catalog = parseInt(argv[++i], 10);
    else if (a === "--start") args.start = parseInt(argv[++i], 10);
    else if (a === "--end") args.end = parseInt(argv[++i], 10);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--delay") args.delay = parseInt(argv[++i], 10);
    else if (a === "--pages") args.pages = argv[++i];
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--lots-only") args.lotsOnly = true;
    else if (a === "--debug-dir") args.debugDir = argv[++i];
    else if (a === "--help" || a === "-h") {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      usage();
      process.exit(1);
    }
  }

  if (args.catalog == null && (args.start == null || args.end == null)) {
    console.error("Provide either --catalog <id> or --start <n> --end <n>");
    usage();
    process.exit(1);
  }

  return args;
}

function usage() {
  console.log(`
Usage:
  ./capt-harvest.js --catalog 80 --out catalog80.json --verbose
  ./capt-harvest.js --start 1 --end 250 --out captains-results.json

Options:
  --catalog <id>       Scrape one catalog
  --start <n>          Start catalog id
  --end <n>            End catalog id
  --out <file>         Output JSON file
  --delay <ms>         Delay between requests (default: 1000)
  --pages <a-b>        Restrict page range
  --verbose            Verbose logging
  --lots-only          Only collect lot URLs
  --debug-dir <dir>    Save debug HTML here (default: capt-debug)
  --help, -h           Show help
`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(...args) {
  console.log(...args);
}

function vlog(enabled, ...args) {
  if (enabled) console.log(...args);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function htmlDecode(str) {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(str) {
  return htmlDecode(
    String(str || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function previewText(str, max = 500) {
  return String(str || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function parsePageRange(spec) {
  if (!spec) return null;
  const m = /^(\d+)-(\d+)$/.exec(spec);
  if (!m) throw new Error(`Bad --pages range: ${spec}`);
  return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
}

function uniqBy(arr, keyFn) {
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function buildCatalogCandidates(catalogId, page) {
  return [
    {
      kind: "catalog",
      url: `${BASE}/auctions/catalog/id/${catalogId}?items=100&page=${page}`
    },
    {
      kind: "mobile",
      url: `${BASE}/m/view-auctions/catalog/id/${catalogId}?page=${page}`
    },
    {
      kind: "print",
      url: `${BASE}/auctions/print-catalog/id/${catalogId}`
    }
  ];
}

async function fetchText(url, verbose = false) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      "accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "upgrade-insecure-requests": "1"
    }
  });

  const text = await res.text();
  const contentType = res.headers.get("content-type") || "";
  const finalUrl = res.url || url;

  vlog(verbose, `[HTTP] ${res.status} ${url}`);
  vlog(verbose, `       final: ${finalUrl}`);
  vlog(verbose, `       type : ${contentType}`);
  vlog(verbose, `       bytes: ${text.length}`);
  vlog(verbose, `       head : ${previewText(text, 350)}`);

  return {
    ok: res.ok,
    status: res.status,
    url,
    finalUrl,
    contentType,
    text
  };
}

function saveDebug(debugDir, name, body) {
  ensureDir(debugDir);
  fs.writeFileSync(`${debugDir}/${name}`, body, "utf8");
}

function looksBlockedOrShell(html) {
  const t = stripTags(html).toLowerCase();
  return (
    t.includes("please wait") ||
    t.includes("enable javascript") ||
    t.includes("checking your browser") ||
    t.includes("access denied") ||
    t.includes("captcha") ||
    t.includes("cloudflare") ||
    t.includes("just a moment")
  );
}

function extractLotLinksFromCatalog(html, fallbackCatalogId) {
  const out = [];

  const patterns = [
    /https?:\/\/bid\.captainsauctionwarehouse\.com\/lot-details\/index\/catalog\/(\d+)\/lot\/(\d+)\/([^"'<> ]*)/gi,
    /\/lot-details\/index\/catalog\/(\d+)\/lot\/(\d+)\/([^"'<> ]*)/gi,
    /["'](\/lot-details\/index\/catalog\/(\d+)\/lot\/(\d+)\/[^"']*)["']/gi,
    /["'](https?:\/\/bid\.captainsauctionwarehouse\.com\/lot-details\/index\/catalog\/(\d+)\/lot\/(\d+)\/[^"']*)["']/gi
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      let catalogId, lotId, rawUrl;

      if (m[1] && m[2] && m[3] !== undefined && /^https?:\/\//i.test(m[0])) {
        catalogId = parseInt(m[1], 10);
        lotId = parseInt(m[2], 10);
        rawUrl = m[0];
      } else if (m[1] && m[2] && m[3] !== undefined && m[0].startsWith("/")) {
        catalogId = parseInt(m[1], 10);
        lotId = parseInt(m[2], 10);
        rawUrl = m[0];
      } else if (m[1] && m[2] && m[3]) {
        rawUrl = m[1];
        catalogId = parseInt(m[2], 10);
        lotId = parseInt(m[3], 10);
      }

      if (!catalogId || !lotId) continue;

      const url = rawUrl.startsWith("http") ? rawUrl : `${BASE}${rawUrl}`;
      out.push({ catalogId, lotId, url });
    }
  }

  return uniqBy(out, x => `${x.catalogId}:${x.lotId}`);
}

function extractLotRowsFromPrintCatalog(html, fallbackCatalogId) {
  const text = stripTags(html);
  const out = [];

  const re = /\bLot\s+(\d+)\.\s+(.+?)(?=\bLot\s+\d+\.\s+|$)/gis;
  let m;
  while ((m = re.exec(text)) !== null) {
    const lotNumber = parseInt(m[1], 10);
    const title = m[2].trim().replace(/\s+/g, " ");
    out.push({
      catalogId: fallbackCatalogId,
      lotId: null,
      lotNumber,
      title,
      url: null,
      source: "print"
    });
  }

  return out;
}

function extractTitle(html) {
  const candidates = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"]+)["']/i,
    /<title>(.*?)<\/title>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i
  ];

  for (const re of candidates) {
    const m = re.exec(html);
    if (m) {
      const t = stripTags(m[1]).trim();
      if (t) return t;
    }
  }
  return null;
}

function normalizeMoney(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}

function extractStatusAndPrice(html) {
  const text = stripTags(html);

  const patterns = [
    { status: "sold", re: /\b(?:sold(?:\s+for)?|hammer price|final bid|winning bid|current bid)\b[^$]{0,80}\$([0-9,]+(?:\.[0-9]{2})?)/i },
    { status: "passed", re: /\bpassed\b/i },
    { status: "withdrawn", re: /\bwithdrawn\b/i },
    { status: "unsold", re: /\bunsold\b/i }
  ];

  for (const p of patterns) {
    const m = p.re.exec(text);
    if (m) {
      return {
        status: p.status,
        price: m[1] ? normalizeMoney(m[1]) : null,
        rawMatch: m[0]
      };
    }
  }

  return { status: "unknown", price: null, rawMatch: null };
}

async function tryCatalogEndpoint(catalogId, page, args) {
  const candidates = buildCatalogCandidates(catalogId, page);

  for (const c of candidates) {
    const res = await fetchText(c.url, args.verbose);

    const fname = `catalog_${catalogId}_page_${page}_${c.kind}.html`;
    saveDebug(args.debugDir, fname, res.text);

    log(`  tried ${c.kind}: status=${res.status} bytes=${res.text.length}`);

    if (looksBlockedOrShell(res.text)) {
      log(`    looks like block/shell page`);
      continue;
    }

    const lots = extractLotLinksFromCatalog(res.text, catalogId);
    if (lots.length) {
      log(`    extracted ${lots.length} lot links from ${c.kind}`);
      return {
        kind: c.kind,
        html: res.text,
        lots,
        printRows: []
      };
    }

    if (c.kind === "print") {
      const printRows = extractLotRowsFromPrintCatalog(res.text, catalogId);
      if (printRows.length) {
        log(`    extracted ${printRows.length} print rows from ${c.kind}`);
        return {
          kind: c.kind,
          html: res.text,
          lots: [],
          printRows
        };
      }
    }

    log(`    no parseable lots from ${c.kind}`);
  }

  return null;
}

async function scrapeLot(lot, args) {
  if (!lot.url) {
    return {
      ...lot,
      ok: true,
      status: "unknown",
      price: null,
      rawStatusText: null
    };
  }

  await sleep(args.delay);
  const res = await fetchText(lot.url, args.verbose);

  const safeLotId = lot.lotId == null ? "unknown" : lot.lotId;
  saveDebug(args.debugDir, `lot_${lot.catalogId}_${safeLotId}.html`, res.text);

  if (!res.ok) {
    return {
      ...lot,
      ok: false,
      error: `HTTP ${res.status}`,
      statusCode: res.status
    };
  }

  const title = extractTitle(res.text);
  const statusInfo = extractStatusAndPrice(res.text);

  return {
    ...lot,
    ok: true,
    title: title || lot.title || null,
    status: statusInfo.status,
    price: statusInfo.price,
    rawStatusText: statusInfo.rawMatch
  };
}

async function scrapeCatalog(catalogId, args) {
  const pageRange = parsePageRange(args.pages);
  const firstPage = pageRange ? pageRange.start : 1;
  const lastPage = pageRange ? pageRange.end : 3;

  const foundLots = [];
  const seen = new Set();

  log(`\n=== Catalog ${catalogId} ===`);

  for (let page = firstPage; page <= lastPage; page++) {
    await sleep(args.delay);

    const found = await tryCatalogEndpoint(catalogId, page, args);
    if (!found) {
      log(`  page ${page}: nothing useful from any endpoint`);
      if (page === firstPage) break;
      continue;
    }

    let candidates = [];

    if (found.lots.length) {
      candidates = found.lots;
    } else if (found.printRows.length) {
      candidates = found.printRows;
    }

    let newCount = 0;
    for (const item of candidates) {
      const key = item.lotId != null
        ? `${item.catalogId}:${item.lotId}`
        : `print:${item.catalogId}:${item.lotNumber}:${item.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        foundLots.push(item);
        newCount++;
      }
    }

    log(`  page ${page}: ${newCount} new entries`);
    if (found.kind === "print") {
      log(`  print catalog usually covers whole sale; stopping page loop`);
      break;
    }
  }

  if (args.lotsOnly) return foundLots;

  const results = [];
  for (let i = 0; i < foundLots.length; i++) {
    const lot = foundLots[i];
    log(`  lot ${i + 1}/${foundLots.length}: ${lot.lotId ?? `print-lot-${lot.lotNumber}`}`);
    const row = await scrapeLot(lot, args);
    results.push(row);
  }

  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.debugDir);

  const catalogs = args.catalog != null
    ? [args.catalog]
    : Array.from({ length: args.end - args.start + 1 }, (_, i) => args.start + i);

  const all = [];

  for (const catalogId of catalogs) {
    try {
      const rows = await scrapeCatalog(catalogId, args);
      all.push(...rows);
    } catch (err) {
      log(`Catalog ${catalogId} failed: ${err.message}`);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    site: BASE,
    count: all.length,
    results: all
  };

  fs.writeFileSync(args.out, JSON.stringify(payload, null, 2), "utf8");
  log(`\nWrote ${args.out}`);
  log(`Rows: ${all.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});