const API_BASE_URL = "";
const ADS_JSON_URL = "scrapester.json";

let allAds = [];
let filteredAds = [];
let sortField = "postedTime";

const SORT_DEFAULT_DIR = {
    distance: "asc",      // closest first
    price: "asc",         // cheapest first
    postedTime: "desc",   // newest first
    title: "asc",         // A → Z
    author: "asc",        // A → Z
    source: "asc"         // A → Z
};

let sortDir = SORT_DEFAULT_DIR[sortField] || "asc";

let favorites = [];

let activeQuickRange = -1; // -1 = none active, 0=4h, 1=12h, 2=1d
let showHidden = false;    // global toggle

let homeLat = null;
let homeLon = null;

let generatedAtISO = null;

const searchInput = document.getElementById("searchInput");
const tbody = document.getElementById("adsTbody");
const favoritesWrapper = document.getElementById("favoritesWrapper");
const dateTimeFilter = document.getElementById("dateTimeFilter");

const btnLast4h = document.getElementById("btnLast4h");
const btnLast12h = document.getElementById("btnLast12h");
const btnLast1d = document.getElementById("btnLast1d");

const btnDistance = document.getElementById("btnDistance");
const distanceCapLabel = document.getElementById("distanceCapLabel");

const btnPrice = document.getElementById("btnPrice");
const priceCapLabel = document.getElementById("priceCapLabel");

const metaIcon = document.getElementById("scrapeMetaIcon");

const resultsPill = document.getElementById("resultsPill");

let distanceCapMiles = 500; // default
const DISTANCE_CAP_OPTIONS = [50, 100, 250, 500, 1000, Infinity];

let priceCapDollars = 1000; // default
const PRICE_CAP_OPTIONS = [100, 500, 750, 1000, 1500, 2500, 5000, 10000, Infinity];

// --- Location settings storage keys ---
const LS_LOC_MODE = "adster.location.mode";         // "browser" | "fixed"
const LS_LOC_SAVED_ID = "adster.location.savedId";
const LS_LOC_CUSTOM_LAT = "adster.location.customLat";
const LS_LOC_CUSTOM_LON = "adster.location.customLon";
const LS_LOC_FALLBACK_ID = "adster.location.fallbackId";
const LS_DISTANCE_CAP = "adster.distance.capMiles"; // number, default 500
const LS_PRICE_CAP = "adster.price.capDollars";     // number, default 1000
// --- Hidden ads storage key ---
const LS_HIDDEN_AD_IDS = "adster.hiddenAdIDs"; // JSON array of adID strings

// --- Show hidden ads setting key ---
const LS_SHOW_HIDDEN = "adster.showHidden"; // "1" | "0"

// --- Favorite ads storage key ---
const LS_FAVORITE_AD_IDS = "adster.favoriteAdIDs"; // JSON array of adID strings

function loadFavoriteIds() {
    try {
        return new Set(JSON.parse(localStorage.getItem(LS_FAVORITE_AD_IDS) || "[]"));
    } catch (e) {
        console.warn("[favorites] failed to parse localStorage, resetting:", e);
        return new Set();
    }
}

function saveFavoriteIds(set) {
    localStorage.setItem(LS_FAVORITE_AD_IDS, JSON.stringify(Array.from(set)));
}

// in-memory set of favorite adIDs
let favoriteIdSet = loadFavoriteIds();

function loadShowHidden() {
    return localStorage.getItem(LS_SHOW_HIDDEN) === "1";
}

function saveShowHidden(v) {
    localStorage.setItem(LS_SHOW_HIDDEN, v ? "1" : "0");
}

function loadHiddenIds() {
    try {
        return new Set(JSON.parse(localStorage.getItem(LS_HIDDEN_AD_IDS) || "[]"));
    } catch (e) {
        console.warn("[hidden] failed to parse localStorage, resetting:", e);
        return new Set();
    }
}

function saveHiddenIds(set) {
    localStorage.setItem(LS_HIDDEN_AD_IDS, JSON.stringify(Array.from(set)));
}

// in-memory set of hidden adIDs
let hiddenIdSet = loadHiddenIds();

// built-in default if nothing else is available
const DEFAULT_HOME = { lat: 30.40198, lon: -86.87008 }; // Navarre, FL (change if you want)

let cachedLocations = null;

function loadDistanceCap() {
    const raw = localStorage.getItem(LS_DISTANCE_CAP);
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
    // support old/empty values
    return 500;
}

function loadPriceCap() {
    const raw = localStorage.getItem(LS_PRICE_CAP);
    const n = Number(raw);

    if (Number.isFinite(n) && n > 0) {
        return (n >= 1000000) ? Infinity : n;
    }
    return 1000;
}

function savePriceCap(n) {
    localStorage.setItem(LS_PRICE_CAP, String(n));
}

function priceToLabel(n) {
    if (n === Infinity) return "Any";
    return `$${Number(n).toLocaleString()}`;
}

function ensurePriceMenu() {
    let menu = document.getElementById("priceMenu");
    if (menu) return menu;

    menu = document.createElement("div");
    menu.id = "priceMenu";
    menu.className = "price-menu hidden";

    PRICE_CAP_OPTIONS.forEach((opt) => {
        const b = document.createElement("button");
        b.type = "button";

        if (opt === Infinity) {
            b.dataset.dollars = "Infinity";
            b.textContent = "Any";
        } else {
            b.dataset.dollars = String(opt);
            b.textContent = `$${Number(opt).toLocaleString()}`;
        }

        menu.appendChild(b);
    });

    document.body.appendChild(menu);

    // click away to close
    document.addEventListener("pointerdown", (e) => {
        if (menu.classList.contains("hidden")) return;
        if (e.target === btnPrice) return;
        if (menu.contains(e.target)) return;
        menu.classList.add("hidden");
    });

    // menu selection
    menu.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-dollars]");
        if (!b) return;

        const raw = b.dataset.dollars;
        const val = (raw === "Infinity") ? Infinity : Number(raw);
        if (val !== Infinity && (!Number.isFinite(val) || val <= 0)) return;

        priceCapDollars = val;

        // store Infinity as a big number like distance does
        savePriceCap(val === Infinity ? 1000000 : val);

        updatePriceCapLabel();
        menu.classList.add("hidden");
        applyFilter();
    });

    return menu;
}

function openPriceMenu() {
    if (!btnPrice) return;
    const menu = ensurePriceMenu();

    // mark active item
    Array.from(menu.querySelectorAll("button")).forEach((b) => {
        const val = Number(b.dataset.dollars);
        b.classList.toggle("active", val === priceCapDollars);
    });

    // position menu under the button
    const r = btnPrice.getBoundingClientRect();
    const top = r.bottom + 6;
    const left = Math.min(r.left, window.innerWidth - 190);

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    menu.classList.remove("hidden");
}

function updatePriceCapLabel() {
    if (!priceCapLabel) return;
    priceCapLabel.textContent = priceToLabel(priceCapDollars);
}


function saveDistanceCap(n) {
    localStorage.setItem(LS_DISTANCE_CAP, String(n));
}

function capToLabel(n) {
    if (n === Infinity) return "1000+";
    return String(n);
}

function ensureDistanceMenu() {
    let menu = document.getElementById("distanceMenu");
    if (menu) return menu;

    menu = document.createElement("div");
    menu.id = "distanceMenu";
    menu.className = "distance-menu hidden";

    DISTANCE_CAP_OPTIONS.forEach((opt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.miles = String(opt);
        b.textContent = (opt === Infinity) ? "1000+" : `${opt} miles`;
        menu.appendChild(b);
    });

    document.body.appendChild(menu);

    // click away to close
    document.addEventListener("pointerdown", (e) => {
        if (menu.classList.contains("hidden")) return;
        if (e.target === btnDistance) return;
        if (menu.contains(e.target)) return;
        menu.classList.add("hidden");
    });

    // menu selection
    menu.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-miles]");
        if (!b) return;

        const raw = b.dataset.miles;
        const val = (raw === "Infinity") ? Infinity : Number(raw);

        distanceCapMiles = val;
        saveDistanceCap(val === Infinity ? 1000000 : val); // store big number for Infinity
        updateDistanceCapLabel();
        menu.classList.add("hidden");

        applyFilter();
    });

    return menu;
}

function openDistanceMenu() {
    if (!btnDistance) return;
    const menu = ensureDistanceMenu();

    // mark active item
    Array.from(menu.querySelectorAll("button")).forEach((b) => {
        const raw = b.dataset.miles;
        const val = (raw === "Infinity") ? Infinity : Number(raw);
        const active = (distanceCapMiles === Infinity && val === Infinity) || (val === distanceCapMiles);
        b.classList.toggle("active", active);
    });

    // position menu under the button
    const r = btnDistance.getBoundingClientRect();
    const top = r.bottom + 6;
    const left = Math.min(r.left, window.innerWidth - 190);

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    menu.classList.remove("hidden");
}

function updateDistanceCapLabel() {
    if (!distanceCapLabel) return;
    distanceCapLabel.textContent = capToLabel(distanceCapMiles);
}

async function loadLocationsJson() {
    if (cachedLocations && cachedLocations.length) return cachedLocations;

    try {
        const url = new URL("locations.json?v=1", window.location.href).toString();
        console.log("[locations] fetching:", url);

        const r = await fetch(url, { cache: "no-store" });
        console.log("[locations] status:", r.status, r.ok);

        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        cachedLocations = Array.isArray(j.locations) ? j.locations : [];
        console.log("[locations] loaded count:", cachedLocations.length);
    } catch (e) {
        cachedLocations = [];
        console.error("locations.json not available:", e);
        showToast("Could not load locations.json (check Network tab)", 6000);
    }
    return cachedLocations;
}

function getSavedLocationById(list, id) {
    return list.find(x => x.id === id) || null;
}

function getLocSettings() {
    return {
        mode: localStorage.getItem(LS_LOC_MODE) || "browser",  // "browser" | "fixed"
        fixedId: localStorage.getItem(LS_LOC_SAVED_ID) || "", // reuse existing key
        fallbackId: localStorage.getItem(LS_LOC_FALLBACK_ID) || "",
        userLat: localStorage.getItem(LS_LOC_CUSTOM_LAT) || "",
        userLon: localStorage.getItem(LS_LOC_CUSTOM_LON) || "",
    };
}

function setLocSettings(s) {
    localStorage.setItem(LS_LOC_MODE, s.mode);
    localStorage.setItem(LS_LOC_SAVED_ID, s.fixedId || "");
    localStorage.setItem(LS_LOC_FALLBACK_ID, s.fallbackId || "");
    localStorage.setItem(LS_LOC_CUSTOM_LAT, String(s.userLat ?? ""));
    localStorage.setItem(LS_LOC_CUSTOM_LON, String(s.userLon ?? ""));
}

function resolveFixedLocation(locations, locId, userLatStr, userLonStr) {
    const chosen = getSavedLocationById(locations, locId);
    if (!chosen) return { lat: DEFAULT_HOME.lat, lon: DEFAULT_HOME.lon, why: "built-in default" };

    if (chosen.id === "user") {
        const lat = parseNumberOrNull(userLatStr);
        const lon = parseNumberOrNull(userLonStr);
        if (lat != null && lon != null) return { lat, lon, why: "user defined" };
        return { lat: DEFAULT_HOME.lat, lon: DEFAULT_HOME.lon, why: "user defined (invalid) → default" };
    }

    return { lat: chosen.lat, lon: chosen.lon, why: `fixed: ${chosen.label}` };
}

function parseNumberOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

async function getBrowserLatLon() {
    if (!("geolocation" in navigator)) return null;

    return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
        );
    });
}

// ---- simple toast helper for status messages (e.g., chosen location) ----
function showToast(message, duration = 4000) {
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "toast-message";
    toast.textContent = message;
    container.appendChild(toast);

    // animate in
    requestAnimationFrame(() => {
        toast.classList.add("show");
    });

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            if (!container.hasChildNodes() && container.parentNode) {
                container.parentNode.removeChild(container);
            }
        }, 200);
    }, duration);
}

async function resolveHomeLocation() {
    const s = getLocSettings();
    const locations = await loadLocationsJson();

    if (s.mode === "fixed") {
        const fixed = resolveFixedLocation(locations, s.fixedId, s.userLat, s.userLon);
        homeLat = fixed.lat;
        homeLon = fixed.lon;
        showToast(`Location: ${fixed.why}`);
        return;
    }

    // mode === "browser"
    const geo = await getBrowserLatLon();
    if (geo) {
        homeLat = geo.lat;
        homeLon = geo.lon;
        showToast(`Location: browser (${homeLat.toFixed(4)}, ${homeLon.toFixed(4)})`);
        return;
    }

    // fallback to fixed selection
    const fbId = s.fallbackId || s.fixedId; // if not set, reuse fixed
    const fixed = resolveFixedLocation(locations, fbId, s.userLat, s.userLon);
    homeLat = fixed.lat;
    homeLon = fixed.lon;
    showToast(`Location: browser failed → ${fixed.why}`);
}

// helpers (price, distance, time, boolean search, etc.)

function normalizePrice(price) {
    if (!price) return NaN;

    const s = String(price).trim();
    if (/^free$/i.test(s)) return 0;

    const m = s.match(/[\d,.]+/);
    if (!m) return NaN;

    return parseFloat(m[0].replace(/,/g, ""));
}

function normalizeDistance(distance) {
    if (!distance) return NaN;
    // handle "977.7", "977.7 mi", etc.
    const m = String(distance).match(/[\d.]+/);
    if (!m) return NaN;
    return parseFloat(m[0]);
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

function haversineMilesJS(lat1, lon1, lat2, lon2) {
    if (
        lat1 == null || lon1 == null ||
        lat2 == null || lon2 == null
    ) {
        return NaN;
    }

    const R = 3958.8; // Earth radius in miles
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) *
        Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = R * c;

    return d;
}

function updateGeneratedAtTooltip() {
    if (!metaIcon) return;

    if (!generatedAtISO) {
        metaIcon.title = "Data time unknown";
        return;
    }

    const pretty = formatTimestampDisplay(generatedAtISO);
    metaIcon.title = `Data time: ${pretty}`;
}

function priceSortKey(priceText) {
    if (!priceText) {
        // No price – shove to bottom
        return { group: 2, value: Number.POSITIVE_INFINITY };
    }

    const p = String(priceText).trim();

    // Normalize “Free” etc. as $0
    if (/^free$/i.test(p)) {
        return { group: 0, value: 0 };
    }

    // Pure USD like "$1,500" or "$1,500 OBO"
    const usdMatch = p.match(/^\$([\d,]+(?:\.\d+)?)/);
    if (usdMatch) {
        const num = parseFloat(usdMatch[1].replace(/,/g, ""));
        return { group: 0, value: Number.isFinite(num) ? num : Number.POSITIVE_INFINITY };
    }

    // Other currency (CA$, AU$, etc.) – grab the numeric part,
    // but keep them in a separate group so they sort *after* USD.
    const numMatch = p.match(/([\d,]+(?:\.\d+)?)/);
    if (numMatch) {
        const num = parseFloat(numMatch[1].replace(/,/g, ""));
        return { group: 1, value: Number.isFinite(num) ? num : Number.POSITIVE_INFINITY };
    }

    // No digits at all (weird text) – very last
    return { group: 2, value: Number.POSITIVE_INFINITY };
}

// --- time helpers ---

function formatTimestampDisplay(ts) {
    if (!ts) return "";

    const d = new Date(ts);
    if (isNaN(d.getTime())) {
        return String(ts);
    }

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const year = d.getFullYear();
    const monthName = months[d.getMonth()];
    const day = d.getDate(); // no leading zero

    let hour = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const ampm = hour >= 12 ? "pm" : "am";
    hour = hour % 12;
    if (hour === 0) hour = 12;

    return `${monthName} ${day} ${year} ${hour}:${minutes}${ampm}`;
}

function getDateFilterMs() {
    if (!dateTimeFilter || !dateTimeFilter.value) return null;

    const d = new Date(dateTimeFilter.value); // datetime-local -> local time
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
}

function toDateTimeLocalValue(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function sortAds(list) {
    const field = sortField;
    const dir = sortDir === "desc" ? -1 : 1;

    return list.slice().sort((a, b) => {
        if (field === "price") {
            const pa = priceSortKey(a.price);
            const pb = priceSortKey(b.price);

            if (pa.group !== pb.group) {
                return pa.group - pb.group;
            }

            const va = pa.value;
            const vb = pb.value;

            if (!Number.isFinite(va) && !Number.isFinite(vb)) return 0;
            if (!Number.isFinite(va)) return 1;
            if (!Number.isFinite(vb)) return -1;

            return sortDir === "desc" ? vb - va : va - vb;
        }
        if (field === "distance") {
            const da = normalizeDistance(a.distance);
            const db = normalizeDistance(b.distance);
            if (isNaN(da) && isNaN(db)) return 0;
            if (isNaN(da)) return 1;
            if (isNaN(db)) return -1;
            return (da - db) * dir;
        }

        if (field === "postedTime") {
            const ta = new Date(a.postedTime).getTime();
            const tb = new Date(b.postedTime).getTime();

            if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
            if (!Number.isFinite(ta)) return 1;   // invalid/missing times go bottom
            if (!Number.isFinite(tb)) return -1;

            return (ta - tb) * dir; // dir handles asc/desc
        }

        const va = (a[field] || "").toString().toLowerCase();
        const vb = (b[field] || "").toString().toLowerCase();
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
    });
}

function sortAdsWithFavoritesFirst(list) {
    // Favorites: sorted by current sortField/sortDir, then the rest sorted same way.
    const fav = [];
    const rest = [];

    for (const ad of list) {
        const id = ad?.adID || "";
        if (id && favoriteIdSet.has(id)) fav.push(ad);
        else rest.push(ad);
    }

    return sortAds(fav).concat(sortAds(rest));
}

function renderTable() {
    const container = tbody; // #adsTbody (div.ads-grid)
    const sorted = sortAdsWithFavoritesFirst(filteredAds);

    if (!sorted.length) {
        container.innerHTML = '<div class="empty-state">No ads found.</div>';
        updateSortIndicators();
        return;
    }

    const cardsHtml = sorted.map((ad) => {
        const title = ad.title || "";
        const desc = ad.description || "";
        const distance = ad.distance || "";
        const location = ad.location || "";
        const author = ad.author || "";
        const price = ad.price || "";
        const imageUrl = ad.imageUrl || "";
        const adUrl = ad.adUrl || ad.AdUrl || "";
        const source = ad.source || "Other";
        const authorUrl = ad.authorUrl || "";
        const adID = ad.adID || "";

        const dateTimeText = formatTimestampDisplay(ad.postedTime);
        const dateTimeHtml = ad.postedTime
            ? `<span class="ad-datetime">${escapeHtml(dateTimeText)}</span>`
            : `<span class="ad-datetime"></span>`;

        const isHidden = !!ad.hidden;

        // Title line (line 1)
        const titleHtml = adUrl
            ? `<a href="${adUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
            : `<span>${escapeHtml(title)}</span>`;

        // Seller (line 2 right side)
        const authorHtml = author
            ? (authorUrl
                ? `<a href="${authorUrl}" target="_blank" rel="noopener noreferrer" class="ad-author-link">${escapeHtml(author)}</a>`
                : `<span class="ad-author-text">${escapeHtml(author)}</span>`)
            : `<span class="ad-author-text"></span>`;

        // Distance text (line 3 left side)
        const distanceText = distance ? `${escapeHtml(String(distance))} mi` : "";

        // Image (left column)
        const imgHtml = imageUrl
            ? `<a href="${adUrl}" target="_blank" rel="noopener noreferrer">
                 <img class="ad-thumb" src="${imageUrl}" alt="">
               </a>`
            : "";

        // Hide/show action
        let hideShowLabel, hideShowAction, hideShowTitle;
        if (isHidden) {
            hideShowLabel = "👁️";
            hideShowAction = "show";
            hideShowTitle = "Unhide ad";
        } else {
            hideShowLabel = "✖";
            hideShowAction = "hide";
            hideShowTitle = "Hide ad";
        }

        // Description (line 4) — we escape so it can’t break the card HTML.
        // (Your CSS clamps it to a few lines.)
        const descSafe = escapeHtml(desc);

        return `
<div class="ad-card ${isHidden ? "hidden-ad" : ""}" data-ad-id="${escapeAttr(adID)}">
  <button class="icon-btn hide-toggle card-close"
          data-action="${hideShowAction}"
          data-ad-id="${escapeAttr(adID)}"
          title="${escapeAttr(hideShowTitle)}">
    ${hideShowLabel}
  </button>

  <div class="ad-thumb-wrap">
    ${imgHtml}
  </div>

  <div class="ad-card-body">
    <div class="ad-line1">${titleHtml}</div>

    <div class="ad-line2">
    <span class="ad-price">${escapeHtml(price)}</span>
    ${ad.postedTime ? `<span class="meta-dot">·</span>` : ""}
    ${dateTimeHtml}
    </div>
    
    <div class="ad-line3">
    <span class="ad-distance">${distanceText}</span>
    ${location ? `<span class="meta-dot">·</span>` : ""}
    <span class="ad-location">${escapeHtml(location)}</span>
    </div>

    <div class="ad-line4">${descSafe}</div>

    <div class="ad-card-footer">
    <span class="source-text">
        ${escapeHtml(source)}
        ${author ? `<span class="meta-dot">·</span><span class="ad-footer-author">${authorHtml}</span>` : ""}
    </span>
        <button class="icon-btn fav-toggle ${favoriteIdSet.has(adID) ? "active" : ""}"
                data-action="toggle-fav"
                data-ad-id="${escapeAttr(adID)}"
                title="${favoriteIdSet.has(adID) ? "Unfavorite" : "Favorite"}">
            ${favoriteIdSet.has(adID) ? "♥" : "♡"}
        </button>
        </div>
    </div>
</div>
        `.trim();
    });

    container.innerHTML = cardsHtml.join("");
    updateSortIndicators();
}

/* --- tiny escaping helpers (safe, drop-in) --- */
function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeAttr(s) {
    // Same as escapeHtml, but semantically for attribute contexts.
    return escapeHtml(s);
}

function updateSortIndicators() {
    const buttons = document.querySelectorAll(".sort-btn");
    buttons.forEach((btn) => {
        const f = btn.getAttribute("data-field");
        const span = btn.querySelector(".sort-indicator");
        if (!span) return;

        if (f === sortField) {
            span.textContent = sortDir === "asc" ? "▲" : "▼";
            btn.classList.add("active");
        } else {
            span.textContent = "";
            btn.classList.remove("active");
        }
    });
}

// ------- Wildcard helpers (supports * inside terms) -------
// Goal:
// - '*' should match across spaces/hyphens so "neo*geo" matches "neo geo" and "neo-geo"
// - but prevent ridiculous matches where the left and right parts are far apart in the blob
//   (e.g. "m*pac" should NOT match "mini ... pac-man" when far separated)
//
// Approach:
// 1) Token-level regex (fast + catches "neogeo", "ms-pacman", "mspacman", etc.)
// 2) Blob-level regex with a MAX GAP cap for '*' so it can span "ms pac" but not "mini ... pac"

const _wildcardRegexCache = new Map();
const WILDCARD_MAX_GAP = 16; // chars between fragments when '*' is used (tune 12–20)

function escapeRegExpLiteral(s) {
    return String(s ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termToRegexPair(term) {
    const key = term;
    const cached = _wildcardRegexCache.get(key);
    if (cached) return cached;

    const escaped = escapeRegExpLiteral(term);

    // 1) token regex: '*' matches within a token (no whitespace)
    const tokenPattern = escaped.replace(/\\\*/g, "\\S*");
    const tokenRe = new RegExp(tokenPattern);

    // 2) blob regex: '*' matches up to WILDCARD_MAX_GAP chars (INCLUDING spaces/hyphens/underscores)
    // This allows "m*pac" to match "ms pac", "mrs pac", "m s pac", "ms-pac", etc.
    // but NOT "mini vintage arcade ... pac" because gap is too large.
    const blobGap = `[\\s\\-_a-z0-9]{0,${WILDCARD_MAX_GAP}}`;
    const blobPattern = escaped.replace(/\\\*/g, blobGap);
    const blobRe = new RegExp(blobPattern);

    const pair = { tokenRe, blobRe };
    _wildcardRegexCache.set(key, pair);
    return pair;
}

function matchTermInBlob(term, blob) {
    if (!term) return true;

    // Non-wildcard: fast path
    if (!term.includes("*")) return blob.includes(term);

    const { tokenRe, blobRe } = termToRegexPair(term);

    // 1) token-level match
    const tokens = blob.split(/[^a-z0-9-]+/i).filter(Boolean);
    for (const tok of tokens) {
        if (tokenRe.test(tok)) return true;
    }

    // 2) blob-level match with capped wildcard span
    return blobRe.test(blob);
}

// Simple (non-boolean) search tokenization: supports quoted phrases and whitespace-separated AND
function tokenizeSimpleSearch(qLower) {
    // tokens: "quoted phrase" OR single non-space token
    const re = /"[^"]+"|\S+/g;
    const out = [];
    let m;

    while ((m = re.exec(qLower)) !== null) {
        let t = m[0];

        const isQuoted = t.startsWith('"') && t.endsWith('"');
        if (isQuoted) {
            // Preserve exact interior, INCLUDING leading/trailing spaces
            t = t.slice(1, -1);
            // Only drop completely-empty quoted tokens
            if (t.length === 0) continue;
            out.push(t);
            continue;
        }

        // Unquoted tokens behave as before
        t = t.trim();
        if (t) out.push(t);
    }

    return out;
}

function tokenizeQuery(q) {
    const tokens = [];
    const re = /(\()|(\))|(&&|&)|(\|\||\|)|(!)|("[^"]+"|[^\s&|()!]+)/g;
    let m;

    while ((m = re.exec(q)) !== null) {
        if (m[1]) tokens.push({ type: "LPAREN" });
        else if (m[2]) tokens.push({ type: "RPAREN" });
        else if (m[3]) tokens.push({ type: "AND" });
        else if (m[4]) tokens.push({ type: "OR" });
        else if (m[5]) tokens.push({ type: "NOT" });
        else if (m[6]) {
            let term = m[6];
            if (term.startsWith('"') && term.endsWith('"')) {
                term = term.slice(1, -1);
            }
            tokens.push({ type: "TERM", value: term });
        }
    }

    // Optional quality-of-life: implicit AND between adjacent terms / groups
    // Example: (pinball stern) => (pinball & stern)
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
        const a = tokens[i];
        out.push(a);

        const b = tokens[i + 1];
        if (!b) continue;

        const aCanEnd =
            a.type === "TERM" || a.type === "RPAREN";
        const bCanStart =
            b.type === "TERM" || b.type === "LPAREN" || b.type === "NOT";

        // Insert AND if they are adjacent without an operator
        if (aCanEnd && bCanStart) {
            out.push({ type: "AND" });
        }
    }

    return out;
}

function parseBooleanExpression(tokens) {
    let pos = 0;

    function peek() {
        return tokens[pos];
    }

    function consume(type) {
        const t = tokens[pos];
        if (!t || (type && t.type !== type)) {
            throw new Error("Parse error");
        }
        pos++;
        return t;
    }

    function parseOr() {
        let node = parseAnd();
        while (peek() && peek().type === "OR") {
            consume("OR");
            const right = parseAnd();
            node = { type: "OR", left: node, right };
        }
        return node;
    }

    function parseAnd() {
        let node = parseNot();
        while (peek() && peek().type === "AND") {
            consume("AND");
            const right = parseNot();
            node = { type: "AND", left: node, right };
        }
        return node;
    }

    function parseNot() {
        if (peek() && peek().type === "NOT") {
            consume("NOT");
            const expr = parseNot();
            return { type: "NOT", expr };
        }
        return parsePrimary();
    }

    function parsePrimary() {
        const t = peek();
        if (!t) throw new Error("Unexpected end");

        if (t.type === "LPAREN") {
            consume("LPAREN");
            const node = parseOr();
            consume("RPAREN");
            return node;
        }

        if (t.type === "TERM") {
            consume("TERM");
            return { type: "TERM", value: t.value };
        }

        throw new Error("Unexpected token: " + t.type);
    }

    const expr = parseOr();
    if (pos !== tokens.length) {
        throw new Error("Extra tokens");
    }
    return expr;
}

function evalBooleanExpression(node, blob) {
    switch (node.type) {
        case "TERM":
            return matchTermInBlob(node.value, blob);
        case "AND":
            return (
                evalBooleanExpression(node.left, blob) &&
                evalBooleanExpression(node.right, blob)
            );
        case "OR":
            return (
                evalBooleanExpression(node.left, blob) ||
                evalBooleanExpression(node.right, blob)
            );
        case "NOT":
            return !evalBooleanExpression(node.expr, blob);
        default:
            return true;
    }
}

function updateResultsPill() {
    if (!resultsPill) return;

    const shown = Array.isArray(filteredAds) ? filteredAds.length : 0;
    const total = Array.isArray(allAds) ? allAds.length : 0;

    // compact display
    resultsPill.textContent = `${shown} / ${total.toLocaleString()}`;

    // tooltip (more detailed)
    const hiddenCount = Array.from(hiddenIdSet || []).length;
    resultsPill.title = `Showing ${shown} of ${total.toLocaleString()} • Hidden stored: ${hiddenCount.toLocaleString()}`;

    // "active" look if any filtering is happening
    const hasSearch = !!(searchInput && searchInput.value && searchInput.value.trim());
    const hasDate = !!(dateTimeFilter && dateTimeFilter.value);
    const hasDistanceCap = (typeof distanceCapMiles === "number" && distanceCapMiles !== Infinity);
    const hasPriceCap = (typeof priceCapDollars === "number" && Number.isFinite(priceCapDollars) && priceCapDollars > 0);
    const hasHiddenFiltering = !showHidden; // when false, hidden are excluded

    const isActive = hasSearch || hasDate || hasDistanceCap || hasPriceCap || hasHiddenFiltering;
    resultsPill.classList.toggle("active", isActive);
}

// --- filter logic (tweaked to respect showHidden) ---

function applyFilter() {
    const raw = searchInput.value;          // keep exact user input
    const qTrim = raw.trim();              // only for "is it empty?"
    const q = raw.toLowerCase();
    const filterMs = getDateFilterMs();

    const prepareBlob = (ad) =>
        [
            ad.title,
            ad.description,
            ad.location,
            ad.author,
            ad.price,
            ad.source,
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

    let matcher;

    if (!qTrim) {
        matcher = (ad) => true;
    } else {
        const isBooleanMode = /[&|()!]/.test(qTrim.toLowerCase());

        if (!isBooleanMode) {
            // Simple mode:
            // - space-separated tokens are AND
            // - tokens may include * wildcards
            // - supports "quoted phrases"
            const terms = tokenizeSimpleSearch(q);

            matcher = (ad) => {
                const blob = prepareBlob(ad);
                for (const t of terms) {
                    if (!matchTermInBlob(t, blob)) return false;
                }
                return true;
            };
        } else {
            try {
                const tokens = tokenizeQuery(q);
                const expr = parseBooleanExpression(tokens);
                matcher = (ad) => {
                    const blob = prepareBlob(ad);
                    return evalBooleanExpression(expr, blob);
                };
            } catch (err) {
                console.error("Boolean search parse error, falling back:", err);

                // fallback: treat like simple mode with wildcard+AND
                const terms = tokenizeSimpleSearch(q);
                matcher = (ad) => {
                    const blob = prepareBlob(ad);
                    for (const t of terms) {
                        if (!matchTermInBlob(t, blob)) return false;
                    }
                    return true;
                };
            }
        }
    }

    filteredAds = allAds.filter((ad) => {
        // respect hidden flag unless showHidden is on
        if (!showHidden && ad.hidden) return false;

        // text / boolean condition
        if (!matcher(ad)) return false;

        // date/time condition (if set)
        if (filterMs !== null) {
            if (!ad.postedTime) return false;
            const t = new Date(ad.postedTime).getTime();
            if (!Number.isFinite(t) || t < filterMs) return false;
        }

        // distance cap (only applies when we have a numeric distance)
        // If cap is Infinity => don't filter by distance.
        if (distanceCapMiles !== Infinity) {
            const d = normalizeDistance(ad.distance);
            if (!Number.isFinite(d)) return false;      // no distance => drop when capped
            if (d > distanceCapMiles) return false;
        }

        // price cap (max price)
        if (Number.isFinite(priceCapDollars) && priceCapDollars > 0) {
            const p = normalizePrice(ad.price);
            if (!Number.isFinite(p)) return false;      // no price => drop when capped
            if (p > priceCapDollars) return false;
        }

        return true;
    });

    renderTable();
    updateResultsPill();
}

// --- search & clear events ---

function updateQuickRangeButtons() {
    const btns = [btnLast4h, btnLast12h, btnLast1d];
    btns.forEach((btn, idx) => {
        if (!btn) return;
        if (idx === activeQuickRange) btn.classList.add("active");
        else btn.classList.remove("active");
    });
}

function setFilterRelativeHoursToggle(idx, hoursBack) {
    if (activeQuickRange === idx) {
        activeQuickRange = -1;
        dateTimeFilter.value = "";
        applyFilter();
        updateQuickRangeButtons();
        return;
    }

    activeQuickRange = idx;
    const now = new Date();
    const past = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);
    dateTimeFilter.value = toDateTimeLocalValue(past);
    applyFilter();
    updateQuickRangeButtons();
}

if (metaIcon) {
    metaIcon.addEventListener("click", () => {
        loadAds(); // refetch JSON and re-render
    });
}

// wire time buttons
if (btnLast4h) {
    btnLast4h.addEventListener("click", () => setFilterRelativeHoursToggle(0, 4));
}
if (btnLast12h) {
    btnLast12h.addEventListener("click", () => setFilterRelativeHoursToggle(1, 12));
}
if (btnLast1d) {
    btnLast1d.addEventListener("click", () => setFilterRelativeHoursToggle(2, 24));
}

searchInput.addEventListener("input", applyFilter);

const clearSearch = document.getElementById("clearSearch");

clearSearch.addEventListener("click", () => {
    searchInput.value = "";
    applyFilter();
    searchInput.focus();
});

// Date/time filter => re-apply filters
if (dateTimeFilter) {
    dateTimeFilter.addEventListener("change", applyFilter);
}

// ------- favorites UI -------
// (unchanged from your current file)

let activeFavoriteIndex = -1; // -1 = none active

function renderFavorites() {
    if (!favoritesWrapper) return;

    favoritesWrapper.innerHTML = "";

    const cleaned = favorites
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter(Boolean)
        .slice(0, 5);

    if (!cleaned.length) {
        favoritesWrapper.style.display = "none";
        return;
    }

    favoritesWrapper.style.display = "flex";

    cleaned.forEach((fav, idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "favorite-btn";
        btn.textContent = `${idx + 1}♥`;
        btn.title = fav;

        if (idx === activeFavoriteIndex) {
            btn.classList.add("active");
        }

        btn.addEventListener("click", () => {
            if (activeFavoriteIndex !== idx) {
                activeFavoriteIndex = idx;
                searchInput.value = fav;
                applyFilter();
                renderFavorites();
                return;
            }

            activeFavoriteIndex = -1;
            searchInput.value = "";
            applyFilter();
            renderFavorites();
        });

        favoritesWrapper.appendChild(btn);
    });
}

async function loadSettings() {
    try {
        favorites = [];
        renderFavorites();
    } catch (err) {
        console.error("Failed to load settings:", err);
        favorites = [];
        renderFavorites();
    }
}

// --- hide/unhide helpers (client-only, GitHub Pages friendly) ---

function setAdHidden(adID, hidden) {
    try {
        // update storage set
        if (hidden) hiddenIdSet.add(adID);
        else hiddenIdSet.delete(adID);
        saveHiddenIds(hiddenIdSet);

        // update local model
        allAds = allAds.map((ad) =>
            ad.adID === adID ? { ...ad, hidden: hidden ? 1 : 0 } : ad
        );

        applyFilter();
    } catch (err) {
        console.error("Failed to set hidden:", err);
    }
}

async function setupSettingsModal() {
    console.log("[settings] setupSettingsModal start");

    const settingsBtn = document.getElementById("settingsBtn");
    const modal = document.getElementById("settingsModal");
    const closeBtn = document.getElementById("settingsCloseBtn");
    const cancelBtn = document.getElementById("settingsCancelBtn");
    const saveBtn = document.getElementById("settingsSaveBtn");

    const fallbackRow = document.getElementById("fallbackRow");
    const savedRow = document.getElementById("savedRow");
    const fallbackSel = document.getElementById("locFallback");
    const savedSel = document.getElementById("savedLocationSelect");
    const latInput = document.getElementById("locLat");
    const lonInput = document.getElementById("locLon");

    const showHiddenCheckbox = document.getElementById("showHiddenCheckbox");
    const clearHiddenBtn = document.getElementById("clearHiddenBtn");
    const clearFavoritesBtn = document.getElementById("clearFavoritesBtn");

    const modeRadios = Array.from(document.querySelectorAll('input[name="locMode"]'));

    function open() { modal.classList.remove("hidden"); }
    function close() { modal.classList.add("hidden"); }

    function getMode() {
        const r = modeRadios.find(x => x.checked);
        return r ? r.value : "browser";
    }

    function setMode(v) {
        modeRadios.forEach(x => x.checked = (x.value === v));
    }

    function selectedLocId() {
        const mode = getMode();
        return mode === "browser" ? fallbackSel.value : savedSel.value;

    }

    function applyLatLonFromSelection() {
        const id = selectedLocId();
        const loc = getSavedLocationById(list, id);

        if (!loc) return;

        if (loc.id === "user") {
            // don't overwrite user's typed values
            latInput.readOnly = false;
            lonInput.readOnly = false;
            return;
        }

        latInput.value = loc.lat;
        lonInput.value = loc.lon;
        latInput.readOnly = true;
        lonInput.readOnly = true;
    }

    function updateEnablement() {
        const mode = getMode();

        // fallback dropdown only in browser mode
        fallbackRow.style.display = (mode === "browser") ? "" : "none";

        // fixed location dropdown always visible
        savedRow.style.display = (mode === "fixed") ? "" : "none";

        // default to read-only; applyLatLonFromSelection may enable for user
        latInput.readOnly = true;
        lonInput.readOnly = true;

        applyLatLonFromSelection();
    }

    // populate saved locations
    const list = await loadLocationsJson();

    function fillSelect(sel) {
        sel.innerHTML = "";
        const opt0 = document.createElement("option");
        opt0.value = "";
        opt0.textContent = "Select a location…";
        sel.appendChild(opt0);

        for (const loc of list) {
            const opt = document.createElement("option");
            opt.value = loc.id;
            opt.textContent = loc.label;
            sel.appendChild(opt);
        }
    }

    fillSelect(savedSel);
    fillSelect(fallbackSel);

    function syncUIFromStorage() {
        const s = getLocSettings();

        showHiddenCheckbox.checked = loadShowHidden();

        setMode(s.mode);
        savedSel.value = s.fixedId || "";
        fallbackSel.value = s.fallbackId || "";

        // restore user-defined lat/lon (only matters if "user" selected)
        latInput.value = s.userLat || "";
        lonInput.value = s.userLon || "";

        updateEnablement();
    }

    function syncStorageFromUI() {
        const mode = getMode();

        saveShowHidden(!!showHiddenCheckbox.checked);

        const s = {
            mode,
            fixedId: savedSel.value || "",
            fallbackId: fallbackSel.value || "",
            userLat: latInput.value,
            userLon: lonInput.value,
        };

        setLocSettings(s);
    }

    const onClearHidden = (e) => {
        e.preventDefault();
        e.stopPropagation();

        console.log("[hidden] clear clicked");

        try {
            hiddenIdSet = new Set();
            saveHiddenIds(hiddenIdSet);

            // update local model immediately
            allAds = allAds.map((ad) => ({ ...ad, hidden: 0 }));

            applyFilter();
            showToast("Hidden ads cleared");
        } catch (err) {
            console.error("Failed to clear hidden ads:", err);
            showToast("Failed to clear hidden ads", 5000);
        }
    };

    const onClearFavorites = (e) => {
        e.preventDefault();
        e.stopPropagation();

        console.log("[favorites] clear clicked");

        try {
            // If you used the names from the favorites feature:
            //   const LS_FAVORITE_AD_IDS = "adster.favoriteAdIDs";
            //   let favoriteIdSet = loadFavoriteIds();
            favoriteIdSet = new Set();
            localStorage.setItem(LS_FAVORITE_AD_IDS, "[]");

            // Re-apply current filtering/sorting so pinned favorites disappear immediately
            // Use whichever your code currently uses:
            // - applyFilter() if that's your main rerender pipeline
            // - renderTable() if you re-render directly
            if (typeof applyFilter === "function") applyFilter();
            else if (typeof renderTable === "function") renderTable();

            showToast("Favorites cleared");
        } catch (err) {
            console.error("Failed to clear favorites:", err);
            showToast("Failed to clear favorites", 5000);
        }
    };

    // Use pointerup to avoid "pointerup + click" double-firing on mobile taps
    clearHiddenBtn?.addEventListener("pointerup", onClearHidden);

    clearFavoritesBtn?.addEventListener("pointerup", onClearFavorites);

    settingsBtn?.addEventListener("click", () => {
        syncUIFromStorage();
        open();
    });

    closeBtn?.addEventListener("click", close);
    cancelBtn?.addEventListener("click", close);

    modal?.addEventListener("click", (e) => {
        if (e.target === modal) close();
    });

    document.addEventListener("keydown", (e) => {
        if (!modal.classList.contains("hidden") && e.key === "Escape") close();
    });

    modeRadios.forEach(r => r.addEventListener("change", updateEnablement));
    fallbackSel.addEventListener("change", updateEnablement);
    savedSel.addEventListener("change", updateEnablement);

    saveBtn?.addEventListener("click", async () => {

        showHidden = !!showHiddenCheckbox.checked;
        saveShowHidden(showHidden);

        syncStorageFromUI();
        close();

        // apply immediately: recompute distances, re-render
        await resolveHomeLocation();
        await loadAds(); // reload + recompute distances using new homeLat/homeLon
        showToast("Settings saved");
    });
}

// event delegation for action buttons
tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const adID = btn.dataset.adId;
    if (!adID) return;

    if (action === "toggle-fav") {
        try {
            if (favoriteIdSet.has(adID)) favoriteIdSet.delete(adID);
            else favoriteIdSet.add(adID);

            saveFavoriteIds(favoriteIdSet);

            // just re-render with current filters/sort
            renderTable();
        } catch (err) {
            console.error("Failed to toggle favorite:", err);
        }
        return;
    }

    if (action === "hide") {
        setAdHidden(adID, true);
    } else if (action === "show") {
        setAdHidden(adID, false);
    }
});

async function loadAds() {
    tbody.innerHTML = "Loading…";

    try {
        // cache-busting query + no-store so clicking the icon actually refetches
        const res = await fetch(`${ADS_JSON_URL}?t=${Date.now()}`, {
            cache: "no-store"
        });
        if (!res.ok) throw new Error("HTTP " + res.status);

        const json = await res.json();

        generatedAtISO = json.generated_at || null;
        updateGeneratedAtTooltip();

        if (generatedAtISO) {
            const pretty = formatTimestampDisplay(generatedAtISO);
            showToast(`Last Scrape: ${pretty}`);
        }

        // scrapester.json is { generated_at, ads: [...] }
        const ads = Array.isArray(json.ads) ? json.ads : json;

        const haveHome =
            typeof homeLat === "number" &&
            typeof homeLon === "number" &&
            Number.isFinite(homeLat) &&
            Number.isFinite(homeLon);

        ads.forEach((ad) => {
            ad.distance = ad.distance || "";

            if (
                haveHome &&
                typeof ad.lat === "number" &&
                typeof ad.lon === "number" &&
                Number.isFinite(ad.lat) &&
                Number.isFinite(ad.lon)
            ) {
                const miles = haversineMilesJS(homeLat, homeLon, ad.lat, ad.lon);
                if (Number.isFinite(miles)) {
                    ad.distance = miles.toFixed(1);
                }
            }
        });

        allAds = ads;

        // apply persisted hidden state from localStorage
        hiddenIdSet = loadHiddenIds();
        favoriteIdSet = loadFavoriteIds();

        allAds.forEach((ad) => {
            if (!ad) return;
            const id = ad.adID || "";
            ad.hidden = hiddenIdSet.has(id) ? 1 : 0;
        });

        applyFilter();
    } catch (err) {
        console.error("Failed to load ads:", err);
        tbody.innerHTML = "Error loading ads.";
    }
}

// sort-bar button sorting
document.querySelectorAll(".sort-btn").forEach((btn) => {
    const f = btn.getAttribute("data-field");
    if (f === "distance") return; // handled by hybrid handler below
    if (f === "price") return;    // handled by hybrid handler below

    btn.addEventListener("click", () => {
        if (!f) return;

        if (f === sortField) {
            sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
            sortField = f;
            sortDir = SORT_DEFAULT_DIR[f] || "asc";
        }

        renderTable();
    });
});

function sortByDistanceClick() {
    const f = "distance";
    if (f === sortField) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
        sortField = f;
        sortDir = SORT_DEFAULT_DIR[f] || "asc";
    }
    renderTable();
}

function sortByPriceClick() {
    const f = "price";
    if (f === sortField) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
        sortField = f;
        sortDir = SORT_DEFAULT_DIR[f] || "asc";
    }
    renderTable();
}

(function setupDistanceHybrid() {
    if (!btnDistance) return;

    let pressTimer = null;
    let longPressFired = false;

    const LONG_PRESS_MS = 450;

    btnDistance.addEventListener("pointerdown", (e) => {
        longPressFired = false;
        pressTimer = setTimeout(() => {
            longPressFired = true;
            openDistanceMenu();
        }, LONG_PRESS_MS);

        // avoid iOS text selection / context menu weirdness
        btnDistance.setPointerCapture?.(e.pointerId);
    });

    const clear = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    btnDistance.addEventListener("pointerup", (e) => {
        clear();

        // if menu opened, don't sort
        if (longPressFired) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        sortByDistanceClick();
    });

    btnDistance.addEventListener("pointercancel", clear);
    btnDistance.addEventListener("pointerleave", clear);
})();

(function setupPriceHybrid() {
    if (!btnPrice) return;

    let pressTimer = null;
    let longPressFired = false;

    const LONG_PRESS_MS = 450;

    btnPrice.addEventListener("pointerdown", (e) => {
        longPressFired = false;
        pressTimer = setTimeout(() => {
            longPressFired = true;
            openPriceMenu();
        }, LONG_PRESS_MS);

        btnPrice.setPointerCapture?.(e.pointerId);
    });

    const clear = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    btnPrice.addEventListener("pointerup", (e) => {
        clear();

        // if menu opened, don't sort
        if (longPressFired) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        sortByPriceClick();
    });

    btnPrice.addEventListener("pointercancel", clear);
    btnPrice.addEventListener("pointerleave", clear);
})();

// initial load
(async function init() {
    await loadSettings();        // get favorites → render hearts
    await setupSettingsModal();

    // showHidden init (from settings)
    showHidden = loadShowHidden();

    // distance cap init
    const stored = loadDistanceCap();
    distanceCapMiles = (stored >= 1000000) ? Infinity : stored;
    updateDistanceCapLabel();

    // price cap init
    priceCapDollars = loadPriceCap();
    updatePriceCapLabel();

    await resolveHomeLocation(); // pick browser or fallback location (+ toast)
    await loadAds();             // load ads and compute distances with that location

})();
