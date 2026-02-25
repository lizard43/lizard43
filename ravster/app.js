// app.js
const RAV4_JSON_PATH = "./rav4_2026_500.json";
const OPTIONS_JSON_PATH = "./options.json";

const elCardsGrid = document.getElementById("cardsGrid");
const elCompareView = document.getElementById("compareView");
const elStatus = document.getElementById("status");
// const elFooterNote = document.getElementById("footerNote");

const elSearch = document.getElementById("search");
const elClearSearch = document.getElementById("clearSearch");
const elToolbarCount = document.getElementById("toolbarCount");

const elPillSortDistance = document.getElementById("pillSortDistance");
const elPillSortPrice = document.getElementById("pillSortPrice");
const elPillSortEta = document.getElementById("pillSortEta");

const elBtnCompare = document.getElementById("btnCompare");
const elCompareCount = document.getElementById("compareCount");

let selectedVins = new Set();     // up to 3 VINs
let isCompareMode = false;

let ALL = [];          // raw vehicles
let VIEW = [];         // filtered + sorted
let optionPriceMap = new Map();

let sortKey = "distance"; // distance | price | eta
let sortDir = "asc";      // asc | desc
let searchQ = "";

function showGrid() {
  elCompareView.style.display = "none";
  elCardsGrid.style.display = "";
}

function showCompare() {
  elCardsGrid.style.display = "none";
  elCompareView.style.display = "";
}

function fmtMoney(n) {
  if (n === null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function asNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null; // <-- key fix

  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getEffectivePrice(v) {
  const keys = [
    "price.advertizedPrice",
    "price.nonSpAdvertizedPrice",
    "price.totalMsrp"
  ];

  for (const k of keys) {
    const n = asNumber(get(v, k));

    // ignore null AND ignore zero
    if (n !== null && n > 0) {
      return n;
    }
  }

  return null;
}

function cleanColorName(s) {
  if (!s) return s;
  return String(s)
    .replace(/\s*\[extra_cost_color\]/i, "")
    .replace(/\s*\[softex\]/i, "")
    .trim();
}

function normalizeOptions(v) {
  const opts = Array.isArray(v.options) ? v.options : [];
  const map = new Map();
  for (const o of opts) {
    const cd = safeText(o?.optionCd, "");
    if (!cd) continue;
    map.set(cd, safeText(o?.marketingName));
  }
  return map;
}

function collectSelectedVehicles() {
  const byVin = new Map(ALL.map(v => [String(v.vin || ""), v]));
  const sel = [...selectedVins].map(vin => byVin.get(vin)).filter(Boolean);
  return sel.slice(0, 3);
}

function renderCompare() {
  const sel = collectSelectedVehicles();
  if (sel.length === 0) {
    isCompareMode = false;
    renderMainArea();
    return;
  }

  // union of option codes across selected
  const optMaps = sel.map(normalizeOptions);
  const union = new Set();
  for (const m of optMaps) for (const k of m.keys()) union.add(k);

  // sort option codes (simple lexicographic)
  const unionCodes = [...union].sort((a, b) => String(a).localeCompare(String(b)));

  const cols = sel.length;

  const header = `
    <div class="compareTop">
      <div class="compareTitle">Compare (${cols})</div>
      <div class="compareActions">
        <button class="compareBtn" type="button" id="btnCompareBack">Back</button>
        <button class="compareBtn" type="button" id="btnCompareClear">Clear selection</button>
      </div>
    </div>
  `;

  const colHtml = sel.map((v, idx) => {
    const year = safeText(v?.year);
    const modelName = safeText(get(v, "model.marketingName"));
    const headline = `${year} - ${modelName}`;

    const price = getEffectivePrice(v);
    const dealerName = safeText(v?.dealerMarketingName);
    const dealerSite = safeText(v?.dealerWebsite, "");
    const dealerHtml = dealerSite
      ? `<a href="${dealerSite}" target="_blank" rel="noopener noreferrer">${escapeHtml(dealerName)}</a>`
      : `<span>${escapeHtml(dealerName)}</span>`;

    const ext = cleanColorName(safeText(get(v, "extColor.marketingName")));
    const intc = cleanColorName(safeText(get(v, "intColor.marketingName")));

    const base = asNumber(get(v, "price.baseMsrp"));
    const delta = (price !== null && base !== null) ? (price - base) : null;

    const opts = Array.isArray(v?.options) ? v.options : [];
    const optCount = opts.length;

    const topBlocks = `
      <div class="compareBlock">
        <div class="k">Model</div>
        <div class="v">${escapeHtml(headline)}</div>
      </div>

      <div class="compareBlock">
        <div class="k">Price</div>
        <div class="v">${escapeHtml(fmtMoney(price))} - ${dealerHtml}</div>
      </div>

      <div class="compareBlock">
        <div class="k">Colors</div>
        <div class="v">${escapeHtml(ext)} - ${escapeHtml(intc)}</div>
      </div>

      <div class="compareBlock">
        <div class="k">Options</div>
        <div class="v">${escapeHtml(`${optCount} options - ${fmtMoney(delta)}`)}</div>
      </div>
    `;

    const rows = unionCodes.map(cd => {
      const name = optMaps[idx].get(cd);
      if (!name) {
        return `
          <div class="compareOptionRow">
            <div class="optCd">${escapeHtml(cd)}</div>
            <div class="optName optBlank">—</div>
          </div>
        `;
      }
      return `
        <div class="compareOptionRow">
          <div class="optCd">${escapeHtml(cd)}</div>
          <div class="optName">${escapeHtml(name)}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="compareCol">
        ${topBlocks}
        <div class="compareOptions">
          <div class="k" style="color: var(--muted); font-size:12px; margin-bottom:6px;">Option list</div>
          ${rows}
        </div>
      </div>
    `;
  }).join("");

  showCompare();
  elCompareView.innerHTML = `
  <div class="compareWrap">
    ${header}
    <div class="compareGrid" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr));">
      ${colHtml}
    </div>
  </div>
`;

  // wire compare actions
  const back = document.getElementById("btnCompareBack");
  const clear = document.getElementById("btnCompareClear");

  back?.addEventListener("click", () => {
    isCompareMode = false;
    renderMainArea();
  });

  clear?.addEventListener("click", () => {
    selectedVins.clear();
    updateCompareUI();
    isCompareMode = false;
    renderMainArea();
  });
}

function renderMainArea() {
  if (isCompareMode && selectedVins.size > 0) {
    renderCompare();
  } else {
    showGrid();
    // ensure grid matches current VIEW
    elCardsGrid.innerHTML = VIEW.map(cardTemplate).join("");
  }
}

function updateCompareUI() {
  const n = selectedVins.size;
  elCompareCount.textContent = `${n}/3`;
  elBtnCompare.classList.toggle("isShown", n > 0);
  elBtnCompare.disabled = n === 0;
}

function sortLabel(k) {
  if (k === "distance") return "Distance";
  if (k === "price") return "Price";
  if (k === "eta") return "ETA";
  return k;
}

function sortDirGlyph() {
  return (sortDir === "asc") ? "↑" : "↓";
}

function setActiveSortPillUI() {
  const pills = [
    { key: "distance", el: elPillSortDistance },
    { key: "price", el: elPillSortPrice },
    { key: "eta", el: elPillSortEta },
  ];

  for (const p of pills) {
    const active = (p.key === sortKey);
    p.el.classList.toggle("pillActive", active);

    // Set label + direction on active pill only (like Adster)
    if (active) {
      p.el.innerHTML = `${escapeHtml(sortLabel(p.key))}<span class="dir">${sortDirGlyph()}</span>`;
      p.el.setAttribute("aria-pressed", "true");
    } else {
      p.el.textContent = sortLabel(p.key);
      p.el.setAttribute("aria-pressed", "false");
    }
  }
}

function safeText(v, fallback = "—") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

function get(obj, key) {
  if (!obj || !key) return undefined;

  // 1) flat dotted key (your JSON format)
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];

  // 2) fallback: nested traversal
  const parts = key.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
    else return undefined;
  }
  return cur;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildOptionPriceMap(optionsJson) {
  const map = new Map();
  const arr = optionsJson?.options;
  if (!Array.isArray(arr)) return map;

  for (const o of arr) {
    const cd = safeText(o?.optionCd, "");
    if (!cd) continue;
    map.set(cd, {
      optionCd: cd,
      marketingName: safeText(o?.marketingName),
      optionType: safeText(o?.optionType),
      price: asNumber(o?.price),
    });
  }
  return map;
}

function parseEtaDay(item) {
  // Use currFromDate for sorting (you can change to currToDate if you prefer)
  const s = get(item, "eta.currFromDate");
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function fmtEtaShort(item) {
  const from = get(item, "eta.currFromDate");
  const to = get(item, "eta.currToDate");
  const tf = from ? Date.parse(from) : NaN;
  const tt = to ? Date.parse(to) : NaN;

  const df = Number.isFinite(tf) ? new Date(tf) : null;
  const dt = Number.isFinite(tt) ? new Date(tt) : null;

  // e.g. "Mar 11–Mar 16"
  const fmt = (d) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  if (df && dt) return `${fmt(df)}–${fmt(dt)}`;
  if (df) return fmt(df);
  if (dt) return fmt(dt);
  return "—";
}

function cardTemplate(item) {
  const year = safeText(item?.year);
  const modelName = safeText(get(item, "model.marketingName"));
  const vin = safeText(item?.vin);
  const isSelected = selectedVins.has(vin);

  const adv = getEffectivePrice(item);
  const base = asNumber(get(item, "price.baseMsrp"));
  const delta = (adv !== null && base !== null) ? (adv - base) : null;

  const dealerName = safeText(item?.dealerMarketingName);
  const dealerSite = safeText(item?.dealerWebsite, "");

  const ext = cleanColorName(safeText(get(item, "extColor.marketingName")));
  const intc = cleanColorName(safeText(get(item, "intColor.marketingName")));

  const opts = Array.isArray(item?.options) ? item.options : [];
  const optCount = opts.length;

  const headline = `${year} - ${modelName}`;
  const priceLineLeft = fmtMoney(adv);

  const dist = asNumber(item?.distance);
  const distText = (dist !== null) ? `${dist.toLocaleString()} mi` : "—";

  const dealerHtml = dealerSite
    ? `<a href="${dealerSite}" target="_blank" rel="noopener noreferrer">${escapeHtml(dealerName)}</a>`
    : `<span>${escapeHtml(dealerName)}</span>`;

  const colorsLine = `${escapeHtml(ext)} - ${escapeHtml(intc)}`;
  const optionsLine = `${optCount} options - ${escapeHtml(fmtMoney(delta))}`;

  const etaShort = fmtEtaShort(item);

  return `
    <article class="card ${isSelected ? "isSelected" : ""}" data-vin="${escapeHtml(vin)}">
      <div class="cardInner">
        <div class="rowTop">
          <div class="headline">${escapeHtml(headline)}</div>

          <div class="rowTopRight">
            <div class="vin">${escapeHtml(vin)}</div>

            <label class="cardCheckWrap" aria-label="Select for compare">
              <input class="cardCheck" type="checkbox" ${isSelected ? "checked" : ""} />
              <span class="cardCheckUi" aria-hidden="true"></span>
            </label>
          </div>
        </div>

        <div class="line">
          <span class="primary">${escapeHtml(priceLineLeft)}</span>
          <span class="muted">-</span>
          <span class="muted">${escapeHtml(distText)}</span>
          <span class="muted">-</span>
          <span class="muted">${dealerHtml}</span>
        </div>

        <div class="line">
          <span class="muted">${colorsLine}</span>
        </div>

        <div class="pills">
          <span class="pill">${escapeHtml(optionsLine)}</span>
          <span class="pill pillRight"><span class="muted">ETA</span> ${escapeHtml(etaShort)}</span>
        </div>
      </div>
    </article>
  `;
}

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status} ${res.statusText}`);
  return await res.json();
}

function buildSearchBlob(item) {
  // Keep this cheap-ish: precompute a lowercased blob once.
  const parts = [
    item?.vin,
    item?.dealerMarketingName,
    item?.dealerCd,
    get(item, "model.marketingName"),
    get(item, "model.marketingTitle"),
    cleanColorName(get(item, "extColor.marketingName")),
    cleanColorName(get(item, "intColor.marketingName")),
    get(item, "drivetrain.code"),
    item?.marketingSeries,
  ];

  parts.push(getEffectivePrice(item));

  // option names/codes can be helpful for searching
  if (Array.isArray(item?.options)) {
    for (const o of item.options) {
      parts.push(o?.optionCd, o?.marketingName, o?.optionType);
    }
  }

  return parts
    .filter(v => v !== null && v !== undefined)
    .map(v => String(v))
    .join(" | ")
    .toLowerCase();
}

async function applyFilterSortRender() {
  // show busy immediately
  document.body.classList.add("isBusy");

  // yield so browser can repaint cursor before heavy work
  await new Promise(requestAnimationFrame);

  const q = searchQ.trim().toLowerCase();

  // filter
  let out = ALL;
  if (q) {
    out = ALL.filter(v => v.__blob.includes(q));
  }

  const dir = (sortDir === "asc") ? 1 : -1;

  const getSortVal = (v) => {
    if (sortKey === "distance") {
      const d = asNumber(v.distance);
      return d === null ? Number.POSITIVE_INFINITY : d;
    }
    if (sortKey === "price") {
      const p = getEffectivePrice(v);
      return p === null ? Number.POSITIVE_INFINITY : p;
    }
    if (sortKey === "eta") {
      const t = parseEtaDay(v);
      return t === null ? Number.POSITIVE_INFINITY : t;
    }
    return 0;
  };

  out = [...out].sort((a, b) => {
    const av = getSortVal(a);
    const bv = getSortVal(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;

    const ap = getEffectivePrice(a) ?? 0;
    const bp = getEffectivePrice(b) ?? 0;
    if (ap !== bp) return (ap - bp) * dir;

    return String(a.vin || "").localeCompare(String(b.vin || "")) * dir;
  });

  VIEW = out;

  // yield again before heavy DOM work
  await new Promise(requestAnimationFrame);

  // yield again before heavy DOM work
  await new Promise(requestAnimationFrame);

  // Always render the grid HTML when VIEW changes.
  // If compare mode is open, keep it visible and DON'T rebuild the grid (fast).
  if (!isCompareMode) {
    showGrid();
    elCardsGrid.innerHTML = VIEW.map(cardTemplate).join("");
  }

  // Update count regardless
  elToolbarCount.textContent = `${VIEW.length.toLocaleString()} / ${ALL.length.toLocaleString()}`;

  elToolbarCount.textContent =
    `${VIEW.length.toLocaleString()} / ${ALL.length.toLocaleString()}`;

  // elFooterNote.textContent =
  //   `Options $ = advertisedPrice - baseMsrp. ETA shown as currFromDate–currToDate.`;

  // clear busy
  document.body.classList.remove("isBusy");
}
function setSearchUI() {
  const has = !!elSearch.value;
  elClearSearch.style.display = has ? "block" : "none";
}

function wireToolbar() {
  // Sort pills: click active pill toggles direction, click new pill sets key (asc by default)
  const onSortPill = (key) => {
    if (sortKey === key) {
      sortDir = (sortDir === "asc") ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir = "asc";
    }
    setActiveSortPillUI();
    applyFilterSortRender();
  };

  elPillSortDistance.addEventListener("click", () => onSortPill("distance"));
  elPillSortPrice.addEventListener("click", () => onSortPill("price"));
  elPillSortEta.addEventListener("click", () => onSortPill("eta"));

  elCardsGrid.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (!t.classList.contains("cardCheck")) return;

    const card = t.closest(".card");
    const vin = card?.getAttribute("data-vin");
    if (!vin) return;

    if (t.checked) {
      if (selectedVins.size >= 3) {
        // revert
        t.checked = false;
        return;
      }
      selectedVins.add(vin);
    } else {
      selectedVins.delete(vin);
    }

    updateCompareUI();
    // update card highlight immediately without full rerender
    card.classList.toggle("isSelected", t.checked);
  });

  elBtnCompare.addEventListener("click", () => {
    isCompareMode = !isCompareMode;
    renderMainArea();
  });

  // Search
  let searchTimer = null;
  elSearch.addEventListener("input", () => {
    setSearchUI();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchQ = elSearch.value || "";
      applyFilterSortRender();
    }, 120);
  });

  elClearSearch.addEventListener("click", () => {
    elSearch.value = "";
    searchQ = "";
    setSearchUI();
    applyFilterSortRender();
    elSearch.focus();
  });

  setSearchUI();
  setActiveSortPillUI();
}

async function main() {
  try {
    elStatus.textContent = "Loading rav4 and options…";

    const [rav4Data, optionsData] = await Promise.all([
      loadJson(RAV4_JSON_PATH),
      loadJson(OPTIONS_JSON_PATH)
    ]);

    optionPriceMap = buildOptionPriceMap(optionsData);

    if (!Array.isArray(rav4Data)) {
      throw new Error("rav4.json must be an array of vehicles.");
    }

    ALL = rav4Data.map(v => ({
      ...v,
      __blob: buildSearchBlob(v),
    }));

    const knownPricedOptions = [...optionPriceMap.values()].filter(o => o.price !== null).length;
    elStatus.textContent =
      `Loaded ${ALL.length.toLocaleString()} vehicles. Loaded ${optionPriceMap.size.toLocaleString()} options (${knownPricedOptions.toLocaleString()} priced).`;

    wireToolbar();
    updateCompareUI();
    applyFilterSortRender();

  } catch (err) {
    console.error(err);
    elStatus.textContent = "Error loading data. Check console.";
    showGrid();
    elCardsGrid.innerHTML = `
      <article class="card">
        <div class="cardInner">
          <div class="headline">Couldn’t load JSON</div>
          <div class="line"><span class="muted">${escapeHtml(err?.message ?? String(err))}</span></div>
          <div class="line"><span class="muted">Tip: serve this folder with a local web server (not file://).</span></div>
        </div>
      </article>
    `;
  }
}

main();