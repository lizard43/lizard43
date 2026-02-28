// MazSter (RAVster-style)
// Expects:
//  - mazda-data.json (object: { count, vehicles: [...] })
//  - dealers.json (for geolocation distance)

const INVENTORY_JSON_PATH = "./mazda-data.json";
const DEALERS_JSON_PATH = "./dealers.json";

const elCardsGrid = document.getElementById("cardsGrid");
const elCompareView = document.getElementById("compareView");

const elSearch = document.getElementById("search");
const elClearSearch = document.getElementById("clearSearch");
const elToolbarCount = document.getElementById("toolbarCount");

const elPillSortPrice = document.getElementById("pillSortPrice");
const elPillSortYear = document.getElementById("pillSortYear");
const elPillSortDist = document.getElementById("pillSortDist");

const elBtnCompare = document.getElementById("btnCompare");
const elCompareCount = document.getElementById("compareCount");

const elToolbarFilters = document.getElementById("toolbarFilters");
const elToolbarActiveFilters = document.getElementById("toolbarActiveFilters");

const elBtnClearSelection = document.getElementById("btnClearSelection");

const filters = {
  year: new Set(),
  model: new Set(),
  trim: new Set(),
  drive: new Set(),
  ext: new Set(),
  int: new Set(),
  dealer: new Set(),
};

// +1 = Positive (selected values MUST match)
// -1 = Negative (selected values MUST NOT match)
const filterPolarity = {
  year: +1,
  model: +1,
  trim: +1,
  drive: +1,
  ext: +1,
  int: +1,
  dealer: +1,
};

let selectedVins = new Set(); // up to 3 VINs
let isCompareMode = false;

let ALL = [];     // raw vehicles
let VIEW = [];    // filtered + sorted

let sortKey = "price"; // price | year | distance
let sortDir = "asc";   // asc | desc
let searchQ = "";

// Dealer geo
let DEALERS_BY_ID = new Map();        // dealerId -> dealer object
let DEALER_DISTANCE_MI = new Map();   // dealerId -> miles (number)
let USER_GEO = null;                  // { lat, lon }

// ---------- Utils ----------
function showGrid() {
  elCompareView.style.display = "none";
  elCardsGrid.style.display = "";
}
function showCompare() {
  elCardsGrid.style.display = "none";
  elCompareView.style.display = "";
}

function safeText(v, fallback = "—") {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length ? s : fallback;
}

function asNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(n) {
  if (n === null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtDateMMDDYY(s) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Strip tags and collapse whitespace (good enough for Mazda accessory HTML snippets)
function cleanHtmlToText(input) {
  if (!input) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = String(input);
  const text = (tmp.textContent || tmp.innerText || "");
  return text.replace(/\s+/g, " ").trim();
}

// Haversine distance (straight-line) in miles
function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.7613; // mean Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function dealerLatLon(dealer) {
  if (!dealer) return null;
  const lat = asNumber(dealer.lat);
  // Mazda dealers.json has both "lon" and "long" (and sometimes both). Prefer lon.
  const lon = asNumber(dealer.lon ?? dealer.long);
  if (lat === null || lon === null) return null;
  return { lat, lon };
}

function fmtMiles(mi) {
  if (mi === null || mi === undefined || !Number.isFinite(mi)) return "— mi";
  const digits = mi < 10 ? 1 : 0;
  return `${mi.toFixed(digits)} mi`;
}

async function loadDealers() {
  try {
    const data = await loadJson(DEALERS_JSON_PATH);
    const arr = Array.isArray(data) ? data : (Array.isArray(data?.dealers) ? data.dealers : null);
    if (!Array.isArray(arr)) return;
    DEALERS_BY_ID = new Map(arr.map(d => [Number(d.id), d]));
  } catch (e) {
    console.warn("Dealers not loaded:", e);
  }
}

function computeAllDealerDistances() {
  DEALER_DISTANCE_MI.clear();
  if (!USER_GEO) return;

  for (const [id, d] of DEALERS_BY_ID.entries()) {
    const ll = dealerLatLon(d);
    if (!ll) continue;
    const mi = haversineMiles(USER_GEO.lat, USER_GEO.lon, ll.lat, ll.lon);
    DEALER_DISTANCE_MI.set(id, mi);
  }
}

function getDealerDistanceLabelForVehicle(v) {
  const id = Number(v?.dealerId);
  if (!Number.isFinite(id)) return "— mi";
  const mi = DEALER_DISTANCE_MI.get(id);
  return fmtMiles(mi);
}

function requestUserGeo() {
  if (!("geolocation" in navigator)) return Promise.resolve(null);

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
    );
  });
}

function priceOf(v) {
  // Mazda data already has "price" and "msrp"
  const p = asNumber(v?.price);
  if (p !== null) return p;
  return asNumber(v?.msrp);
}

function cardHeadline(v) {
  const year = safeText(v?.year);
  const model = safeText(v?.model);
  const trim = safeText(v?.trim, "");
  return trim && trim !== "—" ? `${model} • ${trim}` : `${year} • ${model}`;
}

function facetValue(key, v) {
  if (key === "year") return safeText(v?.year);
  if (key === "model") return safeText(v?.model);
  if (key === "trim") return safeText(v?.trim);
  if (key === "drive") return safeText(v?.drivetrain);
  if (key === "ext") return safeText(v?.exterior);
  if (key === "int") return safeText(v?.interior);
  if (key === "dealer") return safeText(v?.dealerName);
  return "—";
}

const FILTER_DEFS = [
  { key: "year", label: "Year" },
  { key: "model", label: "Model" },
  { key: "trim", label: "Trim" },
  { key: "drive", label: "Drive" },
  { key: "ext", label: "Exterior" },
  { key: "int", label: "Interior" },
  { key: "dealer", label: "Dealer" },
];

// ---------- Search blob ----------
function buildSearchBlob(v) {
  const parts = [
    v?.vin,
    v?.dealerName,
    v?.model,
    v?.trim,
    v?.drivetrain,
    v?.transmission,
    v?.exterior,
    v?.interior,
    v?.price,
    v?.msrp,
  ];

  const addList = (arr, pick) => {
    if (!Array.isArray(arr)) return;
    for (const x of arr) parts.push(pick(x));
  };

  addList(v?.packages, (x) => `${x?.Code || ""} ${x?.Name || ""} ${x?.Description || ""}`);
  addList(v?.options, (x) => `${x?.Code || ""} ${x?.Name || ""} ${x?.Description || ""}`);
  addList(v?.accessories, (x) => `${x?.Code || ""} ${x?.Name || ""} ${cleanHtmlToText(x?.Description || "")}`);

  return parts
    .filter(x => x !== null && x !== undefined)
    .map(x => String(x))
    .join(" | ")
    .toLowerCase();
}

// ---------- Filter UI ----------
function renderActiveFiltersLine() {
  if (!elToolbarActiveFilters) return;

  const parts = [];
  for (const def of FILTER_DEFS) {
    const sel = filters[def.key];
    if (!sel || sel.size === 0) continue;

    const vals = [...sel];
    const short = (vals.length <= 3)
      ? vals.join(", ")
      : `${vals.slice(0, 3).join(", ")} +${vals.length - 3}`;

    const sign = (filterPolarity[def.key] === -1) ? "− " : "+ ";
    parts.push(`<span class="afPill">${escapeHtml(sign + short)}</span>`);
  }

  elToolbarActiveFilters.innerHTML = parts.length ? parts.join(" ") : "";
}

function isAllowedByFilters(v) {
  for (const def of FILTER_DEFS) {
    const sel = filters[def.key];
    if (!sel || sel.size === 0) continue;

    const val = facetValue(def.key, v);
    const pol = filterPolarity[def.key] ?? +1;

    // Negative: selected items must NOT be present
    if (pol === -1) {
      if (sel.has(val)) return false;
    } else {
      // Positive: selected items MUST be present
      if (!sel.has(val)) return false;
    }
  }
  return true;
}

function buildFacetCounts(list, excludeKey) {
  // list is already search-filtered; apply all other filters except excludeKey
  const base = list.filter(v => {
    for (const def of FILTER_DEFS) {
      if (def.key === excludeKey) continue;

      const sel = filters[def.key];
      if (!sel || sel.size === 0) continue;

      const val = facetValue(def.key, v);
      const pol = filterPolarity[def.key] ?? +1;

      if (pol === -1) {
        if (sel.has(val)) return false;   // exclude matches
      } else {
        if (!sel.has(val)) return false;  // require matches
      }
    }
    return true;
  });

  const counts = new Map();
  for (const v of base) {
    const val = facetValue(excludeKey, v);
    counts.set(val, (counts.get(val) || 0) + 1);
  }

  const entries = [...counts.entries()];
  if (excludeKey === "year") {
    entries.sort((a, b) => Number(a[0]) - Number(b[0]));
  } else {
    entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  }

  return { baseCount: base.length, entries };
}

function renderFiltersUI(searchFilteredList) {
  if (!elToolbarFilters) return;

  const html = FILTER_DEFS.map(def => {
    const selSet = filters[def.key];
    const selectedN = selSet.size;
    const pol = filterPolarity[def.key] ?? +1;
    const polClass = (selectedN > 0) ? (pol === -1 ? " isNeg" : " isPos") : "";

    // Always show selected FILTER ITEMS count (even in NEG mode)
    const pillN = selectedN;

    return `
  <div class="flt${polClass}" data-flt="${escapeHtml(def.key)}">
    <button class="fltBtn" type="button" aria-haspopup="true" aria-expanded="false">
        ${escapeHtml(def.label)}
        ${pillN ? `<span class="fltCount">(${pillN})</span>` : `<span class="fltCount"></span>`}
      </button>
        <div class="fltPanel" role="menu" aria-label="${escapeHtml(def.label)}">
          <div class="fltTop">
            <div class="fltTitle">${escapeHtml(def.label)}</div>
            <button class="fltClear" type="button" data-clear="${escapeHtml(def.key)}">Clear</button>
          </div>
          <div class="fltList" data-list="${escapeHtml(def.key)}"></div>
        </div>
      </div>
    `;
  }).join("");

  elToolbarFilters.innerHTML = html;

  // Fill panels
  for (const def of FILTER_DEFS) {
    const { entries } = buildFacetCounts(searchFilteredList, def.key);
    const listEl = elToolbarFilters.querySelector(`.fltList[data-list="${CSS.escape(def.key)}"]`);
    if (!listEl) continue;

    listEl.innerHTML = entries.map(([val, count]) => {
      const checked = filters[def.key].has(val);
      const id = `flt_${def.key}_${btoa(unescape(encodeURIComponent(String(val)))).replaceAll("=", "")}`;
      return `
        <div class="fltItem">
          <div class="fltLeft">
            <input type="checkbox" id="${escapeHtml(id)}" data-key="${escapeHtml(def.key)}" data-val="${escapeHtml(String(val))}" ${checked ? "checked" : ""}/>
            <label for="${escapeHtml(id)}" title="${escapeHtml(String(val))}">${escapeHtml(String(val))}</label>
          </div>
          <div class="fltBadge">${count.toLocaleString()}</div>
        </div>
      `;
    }).join("");
  }
}

function closeAllFilterPanels() {
  if (!elToolbarFilters) return;
  elToolbarFilters.querySelectorAll(".flt").forEach(el => {
    el.classList.remove("isOpen");
    const btn = el.querySelector(".fltBtn");
    btn?.setAttribute("aria-expanded", "false");
  });
}

function wireFiltersUI() {
  if (!elToolbarFilters) return;
  // Long-press toggle: positive (green) <-> negative (red)
  let lpTimer = null;
  let lpKey = null;
  let lpPointerId = null;
  let startX = 0;
  let startY = 0;
  let lpWrapEl = null;
  let lpFired = false;

  // robust click suppression (because UI rerenders during long-press)
  let suppressClickUntil = 0;

  const LONG_PRESS_MS = 550;
  const MOVE_CANCEL_PX = 10; // allow small finger jitter without cancelling

  const clearLP = () => {
    if (lpTimer) window.clearTimeout(lpTimer);
    lpTimer = null;
    lpKey = null;
    lpPointerId = null;
    lpWrapEl = null;
    lpFired = false;
  };

  const togglePolarity = (key, wrapEl) => {
    if (!key || !filters[key]) return;
    if (filters[key].size === 0) return; // only meaningful when something is selected

    // flip model state
    filterPolarity[key] = (filterPolarity[key] === -1) ? +1 : -1;

    // IMMEDIATE UI feedback (don’t wait for re-render)
    if (wrapEl) {
      wrapEl.classList.remove("isPos", "isNeg");
      wrapEl.classList.add(filterPolarity[key] === -1 ? "isNeg" : "isPos");
    }

    // busy cursor immediately + apply
    document.body.classList.add("isBusy");
    applyFilterSortRender();
  };

  elToolbarFilters.addEventListener("pointerdown", (e) => {
    const btn = (e.target instanceof HTMLElement) ? e.target.closest(".fltBtn") : null;
    if (!btn) return;

    const wrap = btn.closest(".flt");
    const key = wrap?.getAttribute("data-flt");
    if (!key) return;

    if (!filters[key] || filters[key].size === 0) return;

    clearLP();
    lpKey = key;
    lpWrapEl = wrap;
    lpPointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    lpFired = false;

    // capture pointer so we reliably get move/up even if DOM rerenders
    try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    lpTimer = window.setTimeout(() => {
      suppressClickUntil = Date.now() + 900;
      lpFired = true;
      togglePolarity(lpKey, lpWrapEl);
    }, LONG_PRESS_MS);
  });

  elToolbarFilters.addEventListener("pointermove", (e) => {
    if (!lpTimer) return;
    if (lpPointerId !== e.pointerId) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if ((dx * dx + dy * dy) > (MOVE_CANCEL_PX * MOVE_CANCEL_PX)) {
      clearLP();
    }
  });

  elToolbarFilters.addEventListener("pointerup", (e) => {
    if (lpPointerId !== e.pointerId) return;
    if (lpFired) suppressClickUntil = Date.now() + 900;
    clearLP();
  });

  elToolbarFilters.addEventListener("pointercancel", (e) => {
    if (lpPointerId !== e.pointerId) return;
    clearLP();
  });

  elToolbarFilters.addEventListener("pointerleave", clearLP);

  elToolbarFilters.addEventListener("click", (e) => {

    if (Date.now() < suppressClickUntil) return;

    const t = e.target;

    if (t instanceof HTMLElement && t.matches("[data-clear]")) {
      const key = t.getAttribute("data-clear");
      if (key && filters[key]) {
        filters[key].clear();
        filterPolarity[key] = +1;
        applyFilterSortRender();
      }
      return;
    }

    const btn = (t instanceof HTMLElement) ? t.closest(".fltBtn") : null;
    if (btn) {
      const wrap = btn.closest(".flt");
      if (!wrap) return;
      const isOpen = wrap.classList.contains("isOpen");
      closeAllFilterPanels();
      wrap.classList.toggle("isOpen", !isOpen);
      btn.setAttribute("aria-expanded", String(!isOpen));
      return;
    }
  });

  elToolbarFilters.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.type !== "checkbox") return;

    const key = t.getAttribute("data-key");
    const val = t.getAttribute("data-val");
    if (!key || val === null) return;

    const set = filters[key];
    if (!set) return;

    if (t.checked) set.add(val);
    else set.delete(val);

    // If cleared out, revert to positive default
    if (set.size === 0) filterPolarity[key] = +1;

    applyFilterSortRender();
  });

  document.addEventListener("click", (e) => {
    const inside = elToolbarFilters.contains(e.target);
    if (!inside) closeAllFilterPanels();
  }, { capture: true });
}

// ---------- Compare ----------
function updateCompareUI() {
  const n = selectedVins.size;
  elCompareCount.textContent = `${n}/3`;
  elBtnCompare.classList.toggle("isShown", n > 0);
  elBtnCompare.disabled = n === 0;
  elBtnClearSelection?.classList.toggle("isShown", n > 0);
  elBtnClearSelection && (elBtnClearSelection.disabled = n === 0);
}

function collectSelectedVehicles() {
  const byVin = new Map(ALL.map(v => [String(v.vin || ""), v]));
  const sel = [...selectedVins].map(vin => byVin.get(vin)).filter(Boolean);
  return sel.slice(0, 3);
}

function summarizeLists(v) {
  const packs = Array.isArray(v?.packages) ? v.packages : [];
  const opts = Array.isArray(v?.options) ? v.options : [];
  const accs = Array.isArray(v?.accessories) ? v.accessories : [];

  const packNames = packs.map(x => safeText(x?.Name, "")).filter(Boolean);
  const optNames = opts.map(x => safeText(x?.Name, "")).filter(Boolean);
  const accNames = accs.map(x => safeText(x?.Name, "")).filter(Boolean);

  return {
    packNames,
    optNames,
    accNames,
    packCount: packs.length,
    optCount: opts.length,
    accCount: accs.length,
    accTotal: accs.reduce((s, a) => s + (asNumber(a?.Price) || 0), 0),
  };
}

function normItem(x) {
  const code = safeText(x?.Code, "");
  const name = safeText(x?.Name, "");
  const price = asNumber(x?.Price);
  const key = (code ? code : name).toLowerCase();
  return { key, code, name, price };
}

function buildUnionRows(sel, pickArr) {
  const map = new Map(); // key -> {key, code, name}
  for (const v of sel) {
    const arr = pickArr(v);
    for (const x of arr) {
      const it = normItem(x);
      if (!it.key) continue;
      if (!map.has(it.key)) map.set(it.key, it);
    }
  }
  return [...map.values()].sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));
}

function buildItemLookup(v, pickArr) {
  const m = new Map();
  const arr = pickArr(v);
  for (const x of arr) {
    const it = normItem(x);
    if (!it.key) continue;
    // if duplicates, keep the first (good enough for now)
    if (!m.has(it.key)) m.set(it.key, it);
  }
  return m;
}

function renderCompareMatrix(rows, lookups, cols) {
  const colStyle = `grid-template-columns: repeat(${cols}, minmax(0, 1fr));`;

  const rowHtml = rows.map(r => {
    const cells = lookups.map(m => {
      const it = m.get(r.key);
      if (!it) return `<div class="compareCell compareCellEmpty">—</div>`;

      const label = (it.code && it.name) ? `${it.code} ${it.name}` : (it.code || it.name);
      const price = (it.price !== null && it.price !== undefined) ? fmtMoney(it.price) : "";

      return `
        <div class="compareCell">
          <div class="compareItem">
            <div class="compareItemName" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
            <div class="compareItemPrice">${price && price !== "—" ? escapeHtml(price) : ""}</div>
          </div>
        </div>
      `;
    }).join("");

    return `<div class="compareRow" style="${colStyle}">${cells}</div>`;
  }).join("");

  return `<div class="compareMatrix">${rowHtml || `<div class="compareRow" style="${colStyle}"><div class="compareCell compareCellEmpty">—</div></div>`}</div>`;
}

function renderCompare() {
  const sel = collectSelectedVehicles();
  if (sel.length === 0) {
    isCompareMode = false;
    renderMainArea();
    return;
  }

  const cols = sel.length;

  const packRows = buildUnionRows(sel, v => Array.isArray(v?.packages) ? v.packages : []);
  const optRows = buildUnionRows(sel, v => Array.isArray(v?.options) ? v.options : []);
  const accRows = buildUnionRows(sel, v => Array.isArray(v?.accessories) ? v.accessories : []);

  const packLookups = sel.map(v => buildItemLookup(v, vv => Array.isArray(vv?.packages) ? vv.packages : []));
  const optLookups = sel.map(v => buildItemLookup(v, vv => Array.isArray(vv?.options) ? vv.options : []));
  const accLookups = sel.map(v => buildItemLookup(v, vv => Array.isArray(vv?.accessories) ? vv.accessories : []));

  const header = `
    <div class="compareTop">
      <div class="compareTitle">Compare (${cols})</div>
      <div class="compareActions">
        <button class="compareBtn" type="button" id="btnCompareBack">Back</button>
      </div>
    </div>
  `;

  const colHtml = sel.map(v => {
    const vin = safeText(v?.vin);
    const headline = safeText(v?.model);
    const trim = safeText(v?.trim, "");
    const price = priceOf(v);
    const dealer = safeText(v?.dealerName);
    const url = safeText(v?.detailsUrl, "");

    const ext = safeText(v?.exterior);
    const intc = safeText(v?.interior);
    const drive = safeText(v?.drivetrain);
    const trans = safeText(v?.transmission);

    const lists = summarizeLists(v);

    const listBlock = (label, arr) => {
      if (!arr.length) return `<div class="v">—</div>`;
      // show up to 8 then summarize
      const max = 8;
      const shown = arr.slice(0, max);
      const more = arr.length - shown.length;
      return `<div class="v">${escapeHtml(shown.join(" • "))}${more > 0 ? ` <span class="muted">(+${more})</span>` : ""}</div>`;
    };

    const dealerHtml = url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(dealer)}</a>`
      : `<span>${escapeHtml(dealer)}</span>`;

    return `
      <div class="compareCol">
        <div class="compareBlock">
          <div class="k">Vehicle</div>
          <div class="v">${escapeHtml(headline)}</div>
        </div>

        <div class="compareBlock">
          <div class="k">VIN</div>
          <div class="v">${escapeHtml(vin)}</div>
        </div>

        <div class="compareBlock">
          <div class="k">Price</div>
          <div class="v">${escapeHtml(fmtMoney(price))} - ${dealerHtml}</div>
        </div>
        <div class="compareBlock">
          <div class="k">Drive / Trans</div>
          <div class="v">${escapeHtml(drive)} • ${escapeHtml(trans)}</div>
        </div>
        <div class="compareBlock">
          <div class="k">Colors</div>
          <div class="v">${escapeHtml(ext)} • ${escapeHtml(intc)}</div>
        </div>

        <div class="compareBlock">
          <div class="k">Pkg / Opt / Acc</div>
          <div class="v">
            ${lists.packCount} pkg • ${lists.optCount} opt • ${lists.accCount} acc • ${escapeHtml(fmtMoney(lists.accTotal))}
          </div>
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

      <div class="compareSection">
        <div class="compareSectionTitle">Packages</div>
        ${renderCompareMatrix(packRows, packLookups, cols)}
      </div>

      <div class="compareSection">
        <div class="compareSectionTitle">Options</div>
        ${renderCompareMatrix(optRows, optLookups, cols)}
      </div>

      <div class="compareSection">
        <div class="compareSectionTitle">Accessories</div>
        ${renderCompareMatrix(accRows, accLookups, cols)}
      </div>

    </div>
  `;

  document.getElementById("btnCompareBack")?.addEventListener("click", () => {
    isCompareMode = false;
    renderMainArea();
  });

}

// ---------- Cards ----------
function rowTemplate(cd, name, price, typeLabel = "") {
  const p = (price !== null && price !== undefined) ? fmtMoney(asNumber(price)) : "";
  return `
    <div class="optRow">
      <div class="optCd">${escapeHtml(safeText(cd, ""))}</div>
      <div class="optType">${escapeHtml(typeLabel)}</div>
      <div class="optName">${escapeHtml(safeText(name, "—"))}</div>
      <div class="optPrice">${p !== "—" ? escapeHtml(p) : ""}</div>
    </div>
  `;
}

function cardTemplate(v) {
  const vin = safeText(v?.vin);
  const isSelected = selectedVins.has(vin);

  const headline = safeText(v?.model);      // model only (removes duplicated year issue)
  const trim = safeText(v?.trim, "");       // define trim for the trim row

  const price = priceOf(v);
  const dealer = safeText(v?.dealerName);
  const dealerId = safeText(v?.dealerId, "");
  const url = safeText(v?.detailsUrl, "");

  const drive = safeText(v?.drivetrain);
  const trans = safeText(v?.transmission);
  const ext = safeText(v?.exterior);
  const intc = safeText(v?.interior);

  const packs = Array.isArray(v?.packages) ? v.packages : [];
  const opts = Array.isArray(v?.options) ? v.options : [];
  const accs = Array.isArray(v?.accessories) ? v.accessories : [];

  const accTotal = accs.reduce((s, a) => s + (asNumber(a?.Price) || 0), 0);

  const dealerHtml = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(dealer)}</a>`
    : `<span>${escapeHtml(dealer)}</span>`;

  const pillText = `${packs.length} pkg • ${opts.length} opt • ${accs.length} acc • ${fmtMoney(accTotal)}`;

  const listHtml = []
    .concat(packs.map(p => rowTemplate(p?.Code, p?.Name || p?.Description, p?.Price, "PKG")))
    .concat(opts.map(o => rowTemplate(o?.Code, o?.Name || o?.Description, o?.Price, "OPT")))
    .concat(accs.map(a => {
      const desc = cleanHtmlToText(a?.Description || "");
      const descHtml = desc ? `<div class="optDesc">${escapeHtml(desc)}</div>` : "";
      return `
        ${rowTemplate(a?.Code, a?.Name, a?.Price, "ACC")}
      `;
    }))
    .join("");

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

        ${(trim && trim !== "—") ? `
          <div class="line">
            <span class="primary">${escapeHtml(trim)}</span>
          </div>
        ` : ``}        

        <div class="line">
          <span class="primary">${escapeHtml(fmtMoney(price))}</span>
          <span class="muted">-</span>
          <span class="muted">${escapeHtml(drive)}</span>
          <span class="muted">-</span>
          <span class="muted">${escapeHtml(trans)}</span>
        </div>

        <div class="line">
          <span class="muted">${escapeHtml(ext)}</span>
          <span class="muted">-</span>
          <span class="muted">${escapeHtml(intc)}</span>
        </div>

        ${(() => {
      const dealerObj = DEALERS_BY_ID.get(Number(v?.dealerId));
      const city = safeText(dealerObj?.city, "");
      const state = safeText(dealerObj?.state, "");
      const location = (city && state) ? `${city}, ${state}` : city || state;

      return `
            <div class="line">
              <span class="muted">
                ${dealerHtml}
                ${(() => {
          const loc = String(v?.vehicleLocation ?? "").trim();
          if (loc === "02") return `<span class="dealerStatus"> - On Lot</span>`;
          if (loc === "01") {
            const eta = fmtDateMMDDYY(v?.etaDate);
            return eta
              ? `<span class="dealerStatus"> - ETA ${escapeHtml(eta)}</span>`
              : `<span class="dealerStatus"> - In Transit</span>`;
          }
          return "";
        })()}
              </span>
            </div>
            <div class="line">
              <span class="muted">${escapeHtml(location)}</span>
              <span class="muted">-</span>
              <span class="muted">${escapeHtml(getDealerDistanceLabelForVehicle(v))}</span>
            </div>
          `;
    })()}

        <div class="pills">
          <button class="pill pillOptions" type="button" aria-expanded="false">
            ${escapeHtml(pillText)}
          </button>
        </div>

        <div class="optExpand" aria-hidden="true">
          <div class="optExpandTop">
            <div class="optExpandTitle">Details</div>
            <button class="optExpandClose" type="button" aria-label="Close options">×</button>
          </div>

          <div class="optExpandList">
            ${listHtml || `<div class="muted" style="font-size:12px;">No packages/options/accessories listed.</div>`}
          </div>
        </div>

      </div>
    </article>
  `;
}

// ---------- Rendering ----------
function renderMainArea() {
  if (isCompareMode && selectedVins.size > 0) {
    renderCompare();
  } else {
    showGrid();
    elCardsGrid.innerHTML = VIEW.map(cardTemplate).join("");
  }
}

function sortLabel(k) {
  if (k === "price") return "Price";
  if (k === "year") return "Year";
  if (k === "distance") return "Distance";
  return k;
}

function sortDirGlyph() { return (sortDir === "asc") ? "↑" : "↓"; }

function setActiveSortPillUI() {
  const pills = [
    { key: "price", el: elPillSortPrice },
    { key: "year", el: elPillSortYear },
    { key: "distance", el: elPillSortDist },
  ];

  for (const p of pills) {
    const active = (p.key === sortKey);
    p.el.classList.toggle("pillActive", active);
    if (active) {
      p.el.innerHTML = `${escapeHtml(sortLabel(p.key))}<span class="dir">${sortDirGlyph()}</span>`;
      p.el.setAttribute("aria-pressed", "true");
    } else {
      p.el.textContent = sortLabel(p.key);
      p.el.setAttribute("aria-pressed", "false");
    }
  }
}

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status} ${res.statusText}`);
  return await res.json();
}

async function applyFilterSortRender() {
  document.body.classList.add("isBusy");
  await new Promise(requestAnimationFrame);

  const q = searchQ.trim().toLowerCase();

  let searchFiltered = ALL;
  if (q) searchFiltered = ALL.filter(v => v.__blob.includes(q));

  let out = searchFiltered.filter(isAllowedByFilters);

  renderFiltersUI(searchFiltered);
  renderActiveFiltersLine();

  const dir = (sortDir === "asc") ? 1 : -1;

  const getSortVal = (v) => {
    if (sortKey === "price") return priceOf(v) ?? Number.POSITIVE_INFINITY;
    if (sortKey === "year") return asNumber(v?.year) ?? Number.POSITIVE_INFINITY;

    if (sortKey === "distance") {
      const id = Number(v?.dealerId);
      const d = DEALER_DISTANCE_MI.get(id);
      return (d !== undefined && d !== null) ? d : Number.POSITIVE_INFINITY;
    }

    return 0;
  };

  out = [...out].sort((a, b) => {
    const av = getSortVal(a);
    const bv = getSortVal(b);

    if (typeof av === "string" || typeof bv === "string") {
      const cmp = String(av).localeCompare(String(bv));
      if (cmp) return cmp * dir;
    } else {
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }

    // tie-breaker: VIN
    return String(a.vin || "").localeCompare(String(b.vin || "")) * dir;
  });

  VIEW = out;

  await new Promise(requestAnimationFrame);

  if (!isCompareMode) {
    showGrid();
    elCardsGrid.innerHTML = VIEW.map(cardTemplate).join("");
  }

  elToolbarCount.textContent = `${VIEW.length.toLocaleString()} / ${ALL.length.toLocaleString()}`;

  document.body.classList.remove("isBusy");
}

// ---------- Wiring ----------
function setSearchUI() {
  const has = !!elSearch.value;
  elClearSearch.style.display = has ? "block" : "none";
}

function wireToolbar() {
  const onSortPill = (key) => {
    if (sortKey === key) sortDir = (sortDir === "asc") ? "desc" : "asc";
    else { sortKey = key; sortDir = "asc"; }
    setActiveSortPillUI();
    applyFilterSortRender();
  };

  elPillSortPrice.addEventListener("click", () => onSortPill("price"));
  elPillSortYear.addEventListener("click", () => onSortPill("year"));
  elPillSortDist.addEventListener("click", () => onSortPill("distance"));

  elBtnClearSelection?.addEventListener("click", () => {
    selectedVins.clear();
    updateCompareUI();
    isCompareMode = false;
    renderMainArea();
  });

  elCardsGrid.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (!t.classList.contains("cardCheck")) return;

    const card = t.closest(".card");
    const vin = card?.getAttribute("data-vin");
    if (!vin) return;

    if (t.checked) {
      if (selectedVins.size >= 3) { t.checked = false; return; }
      selectedVins.add(vin);
    } else {
      selectedVins.delete(vin);
    }

    updateCompareUI();
    card.classList.toggle("isSelected", t.checked);
  });

  function closeAllCardOptionPanels(exceptCard = null) {
    elCardsGrid.querySelectorAll(".card.isOptOpen").forEach(c => {
      if (exceptCard && c === exceptCard) return;
      c.classList.remove("isOptOpen");
      const btn = c.querySelector(".pillOptions");
      const panel = c.querySelector(".optExpand");
      btn?.setAttribute("aria-expanded", "false");
      panel?.setAttribute("aria-hidden", "true");
    });
  }

  elCardsGrid.addEventListener("click", (e) => {
    const t = e.target;

    const closeBtn = (t instanceof HTMLElement) ? t.closest(".optExpandClose") : null;
    if (closeBtn) {
      const card = closeBtn.closest(".card");
      if (!card) return;
      closeAllCardOptionPanels(card);
      return;
    }

    const pill = (t instanceof HTMLElement) ? t.closest(".pillOptions") : null;
    if (!pill) return;

    const card = pill.closest(".card");
    if (!card) return;

    const panel = card.querySelector(".optExpand");
    const isOpen = card.classList.contains("isOptOpen");

    closeAllCardOptionPanels(card);

    card.classList.toggle("isOptOpen", !isOpen);
    pill.setAttribute("aria-expanded", String(!isOpen));
    panel?.setAttribute("aria-hidden", String(isOpen));
  });

  document.addEventListener("click", (e) => {
    const insideCard = elCardsGrid.contains(e.target);
    if (!insideCard) closeAllCardOptionPanels(null);

    if (insideCard) {
      const clickedInsideOpenCard = (e.target instanceof HTMLElement)
        ? !!e.target.closest(".card.isOptOpen")
        : false;
      const clickedPill = (e.target instanceof HTMLElement)
        ? !!e.target.closest(".pillOptions")
        : false;
      if (!clickedInsideOpenCard && !clickedPill) closeAllCardOptionPanels(null);
    }
  }, { capture: true });

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
    const data = await loadJson(INVENTORY_JSON_PATH);

    const arr = Array.isArray(data) ? data : (Array.isArray(data?.vehicles) ? data.vehicles : null);
    if (!Array.isArray(arr)) throw new Error("mazda-data.json must be { vehicles: [...] } or an array.");

    ALL = arr.map(v => ({ ...v, __blob: buildSearchBlob(v) }));

    await loadDealers();

    wireToolbar();
    wireFiltersUI();
    updateCompareUI();
    await applyFilterSortRender();

    // Ask for browser location AFTER initial render (so UI loads even if user denies)
    requestUserGeo().then((geo) => {
      if (!geo) return;

      USER_GEO = geo;
      computeAllDealerDistances();

      if (sortKey === "distance") {
        applyFilterSortRender();   // resort properly
      } else {
        if (!isCompareMode) {
          elCardsGrid.innerHTML = VIEW.map(cardTemplate).join("");
        }
      }
    });

  } catch (err) {
    console.error(err);
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