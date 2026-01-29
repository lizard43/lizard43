const API_BASE_URL = "";
let ADS_JSON_URL = "scrapester.json";

function resolveAdsJsonUrlFromQuery() {
    const sp = new URLSearchParams(window.location.search);

    // Generic override: ?json=somefile.json
    const json = (sp.get("json") || "").trim();
    if (json) return json;

    // Friendly alias: ?cheapo or ?cheapo=1 (also sets persisted state)
    const cheapoRaw = sp.get("cheapo");
    if (sp.has("cheapo")) {
        // treat "?cheapo=0" as OFF, everything else as ON
        if (String(cheapoRaw || "").trim() === "0") return "scrapester.json";
        return "scrapester_cheapo.json";
    }

    // Persisted toggle state (no URL needed)
    if (cheapoMode) return "scrapester_cheapo.json";

    return "scrapester.json";
}


let allAds = [];
let filteredAds = [];
let sortField = "postedTime";

// Sort override from the search bar (e.g., s:da). Null = no override.
let sortOverrideField = null;
let sortOverrideDir = null;

const SORT_DEFAULT_DIR = {
    distance: "asc",      // closest first
    price: "asc",         // cheapest first
    postedTime: "desc",   // newest first
    title: "asc",         // A → Z
    author: "asc",        // A → Z
    source: "asc"         // A → Z
};

let sortDir = SORT_DEFAULT_DIR[sortField] || "asc";

function getEffectiveSortField() {
    return sortOverrideField || sortField;
}

function getEffectiveSortDir() {
    return sortOverrideDir || sortDir;
}

let favorites = [];

let activeQuickRange = -1; // -1 = none active, 0=4h, 1=12h, 2=1d
let showHidden = false;    // global toggle
let showOnlyPriceChanged = false; // toolbar toggle
let cheapoMode = false; // dataset toggle (cheapo json)

let homeLat = null;
let homeLon = null;

let generatedAtISO = null;

let searchDebounceTimer = null;
const SEARCH_DEBOUNCE_MS = 400;

function clearSearchBox({ focus = true } = {}) {
    clearTimeout(searchDebounceTimer);
    searchInput.value = "";
    autosizeSearchBox();
    applyFilterNextFrame();
    if (focus) searchInput.focus();
}

function applyFilterNextFrame() {
    // Let the textarea repaint *before* we rebuild the whole grid.
    // NOTE: a single requestAnimationFrame runs before paint; doing it twice
    // yields one paint so the UI updates immediately even if applyFilter is heavy.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => applyFilter());
    });
}

const searchInput = document.getElementById("searchInput");
const tbody = document.getElementById("adsTbody");
const favoritesWrapper = document.getElementById("favoritesWrapper");
const toolbarMsg = document.getElementById("toolbarMsg");
const toolbarMsgLine1 = document.getElementById("toolbarMsgLine1");
const toolbarMsgLine2 = document.getElementById("toolbarMsgLine2");

let dateFilterMs = null; // replaces datetime-local input

const btnLast4h = document.getElementById("btnLast4h");
const btnLast12h = document.getElementById("btnLast12h");
const btnLast1d = document.getElementById("btnLast1d");
const btnLast1w = document.getElementById("btnLast1w");

const btnPriceChanged = document.getElementById("btnPriceChanged");
const priceChangedBadge = document.getElementById("priceChangedBadge");
const btnCheapo = document.getElementById("btnCheapo");
const btnShare = document.getElementById("btnShare");

const btnDistance = document.getElementById("btnDistance");
const distanceCapLabel = document.getElementById("distanceCapLabel");

const btnPrice = document.getElementById("btnPrice");
const priceCapLabel = document.getElementById("priceCapLabel");
const btnTime = document.getElementById("btnTime");
const timeCapLabel = document.getElementById("timeCapLabel");

const resultsPill = document.getElementById("resultsPill");

const clearSearch = document.getElementById("clearSearch");

let distanceCapMiles = 500; // default
const DISTANCE_CAP_OPTIONS = [50, 100, 250, 500, 1000, Infinity];

let priceCapDollars = 1000; // default
let timeCapDays = Infinity; // default (Any)

const PRICE_CAP_OPTIONS = [100, 500, 750, 1000, 1500, 2500, 5000, 10000, Infinity];

// Time menu options are in DAYS.
// Include quick toolbar ranges too:
//  4h  = 4/24
// 12h  = 12/24
//  1d  = 1
//  1w  = 7
const TIME_CAP_OPTIONS = [4 / 24, 12 / 24, 1, 7, 30, 90, 180, Infinity];

// --- Location settings storage keys ---
const LS_LOC_MODE = "adster.location.mode";         // "browser" | "fixed"
const LS_LOC_SAVED_ID = "adster.location.savedId";
const LS_LOC_CUSTOM_LAT = "adster.location.customLat";
const LS_LOC_CUSTOM_LON = "adster.location.customLon";
const LS_LOC_FALLBACK_ID = "adster.location.fallbackId";
const LS_DISTANCE_CAP = "adster.distance.capMiles"; // number, default 500
const LS_PRICE_CAP = "adster.price.capDollars";     // number, default 1000
const LS_TIME_CAP_DAYS = "adster.time.capDays"; // number, store 30/90/180 or 1000000 for Infinity

// --- Cheapo (dataset) toggle ---
const LS_CHEAPO_MODE = "adster.dataset.cheapo"; // "1" | "0"

// --- Hidden ads storage key ---
const LS_HIDDEN_AD_IDS = "adster.hiddenAdIDs"; // JSON array of adID strings
const LS_INCLUDE_HIDDEN_IN_SEARCH = "adster.includeHiddenInSearch"; // "1" | "0"
let includeHiddenInSearch = (localStorage.getItem(LS_INCLUDE_HIDDEN_IN_SEARCH) === "1");
const btnHiddenSearch = document.getElementById("btnHiddenSearch");

// --- Show hidden ads setting key ---
const LS_SHOW_HIDDEN = "adster.showHidden"; // "1" | "0"

// --- Favorite ads storage key ---
const LS_FAVORITE_AD_IDS = "adster.favoriteAdIDs"; // JSON array of adID strings

// --- Broken image tracking (client-only) ---
const LS_BAD_IMAGE_AD_IDS = "adster.badImageAdIDs"; // JSON array of adID strings
const LS_BAD_IMAGE_GEN_AT = "adster.badImage.generatedAt"; // last JSON generated_at seen

// --- Favorite SEARCH presets (toolbar hearts) ---
const LS_FAV_SEARCH_1 = "adster.favSearch.1";
const LS_FAV_SEARCH_2 = "adster.favSearch.2";
const LS_FAV_SEARCH_3 = "adster.favSearch.3";
const LS_FAV_SEARCH_4 = "adster.favSearch.4";

function favSearchKey(slot) {
    if (slot === 1) return LS_FAV_SEARCH_1;
    if (slot === 2) return LS_FAV_SEARCH_2;
    if (slot === 3) return LS_FAV_SEARCH_3;
    if (slot === 4) return LS_FAV_SEARCH_4;
}

function loadFavSearch(slot) {
    try {
        return localStorage.getItem(favSearchKey(slot)) || "";
    } catch {
        return "";
    }
}

function saveFavSearch(slot, value) {
    const v = String(value ?? "");
    const key = favSearchKey(slot);

    // If empty => clear storage
    if (!v || !v.trim()) {
        localStorage.removeItem(key);
        return "";
    }

    localStorage.setItem(key, v);
    return v;
}

function scrollResultsToTop() {
    const wrapper = document.querySelector(".table-wrapper");
    if (wrapper) wrapper.scrollTop = 0;
}

function autosizeSearchBox() {
    if (!searchInput) return;

    // Reset so scrollHeight is accurate
    searchInput.style.height = "auto";

    // scrollHeight includes padding but not borders. Because we use border-box sizing
    // globally, set height to scrollHeight + border widths so we don't clip the last line
    // (notably on mobile Safari).
    const cs = window.getComputedStyle(searchInput);
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;

    // +1 for rounding quirks on some browsers
    const target = Math.ceil(searchInput.scrollHeight + bt + bb + 1);

    searchInput.style.height = `${target}px`;
}

function loadBadImageIds() {
    try {
        return new Set(JSON.parse(localStorage.getItem(LS_BAD_IMAGE_AD_IDS) || "[]"));
    } catch (e) {
        console.warn("[badimg] failed to parse localStorage, resetting:", e);
        return new Set();
    }
}

function saveBadImageIds(set) {
    localStorage.setItem(LS_BAD_IMAGE_AD_IDS, JSON.stringify(Array.from(set)));
}

let badImageIdSet = loadBadImageIds();

function clearBadImageIds(reason = "") {
    badImageIdSet = new Set();
    localStorage.setItem(LS_BAD_IMAGE_AD_IDS, "[]");
    if (reason) console.log("[badimg] cleared bad-image set:", reason);
}

function syncBadImageSetWithGeneratedAt(incomingGen) {
    const gen = String(incomingGen || "");
    if (!gen) return;

    const prev = String(localStorage.getItem(LS_BAD_IMAGE_GEN_AT) || "");
    if (prev && prev !== gen) {
        clearBadImageIds(`generated_at changed ${prev} -> ${gen}`);
    }
    localStorage.setItem(LS_BAD_IMAGE_GEN_AT, gen);
}

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


function loadCheapoMode() {
    return localStorage.getItem(LS_CHEAPO_MODE) === "1";
}

function saveCheapoMode(v) {
    localStorage.setItem(LS_CHEAPO_MODE, v ? "1" : "0");
}

function renderCheapoToggle() {
    if (!btnCheapo) return;
    btnCheapo.classList.toggle("active", !!cheapoMode);
    btnCheapo.title = cheapoMode
        ? "Cheapo ON (loading scrapester_cheapo.json)"
        : "Cheapo OFF (loading scrapester.json)";
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

function saveIncludeHiddenInSearch(v) {
    localStorage.setItem(LS_INCLUDE_HIDDEN_IN_SEARCH, v ? "1" : "0");
}
function renderHiddenSearchToggle() {
    if (!btnHiddenSearch) return;
    btnHiddenSearch.classList.toggle("active", !!includeHiddenInSearch);
    btnHiddenSearch.title = includeHiddenInSearch
        ? "Including hidden ads in search"
        : "Include hidden ads in search";
}

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
    localStorage.setItem(LS_PRICE_CAP, String(n === Infinity ? 1000000 : n));
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

        savePriceCap(val);

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
        const raw = b.dataset.dollars;
        const val = (raw === "Infinity") ? Infinity : Number(raw);
        const active = (priceCapDollars === Infinity && val === Infinity) || (val === priceCapDollars);
        b.classList.toggle("active", active);
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

function saveTimeCapDays(n) {
    // store Infinity as big number like others
    localStorage.setItem(LS_TIME_CAP_DAYS, String(n === Infinity ? 1000000 : n));
}

function loadTimeCapDays() {
    const raw = localStorage.getItem(LS_TIME_CAP_DAYS);
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
        return (n >= 1000000) ? Infinity : n;
    }
    return Infinity;
}

function timeCapToLabel(days) {
    if (days === Infinity) return "Any";

    // handle the "quick" style options (stored as fractional days)
    // use rounding to avoid float equality issues
    const h = Math.round(days * 24);
    if (h === 4) return "4h";
    if (h === 12) return "12h";

    if (days === 1) return "1d";
    if (days === 7) return "1w";

    if (days === 30) return "1 mo";
    if (days === 90) return "3 mo";
    if (days === 180) return "6 mo";

    // fallback
    if (days < 1) return `${h}h`;
    return `${days}d`;
}

function updateTimeCapLabel() {
    if (!timeCapLabel) return;
    timeCapLabel.textContent = timeCapToLabel(timeCapDays);
}

function ensureTimeMenu() {
    let menu = document.getElementById("timeMenu");
    if (menu) return menu;

    menu = document.createElement("div");
    menu.id = "timeMenu";
    menu.className = "time-menu hidden";

    TIME_CAP_OPTIONS.forEach((opt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.days = String(opt);

        if (opt === Infinity) {
            b.textContent = "Any";
        } else {
            // leverage the same label logic used on the pill
            b.textContent = timeCapToLabel(opt);
        }

        menu.appendChild(b);
    });

    document.body.appendChild(menu);

    // click away to close
    document.addEventListener("pointerdown", (e) => {
        if (menu.classList.contains("hidden")) return;
        if (e.target === btnTime) return;
        if (menu.contains(e.target)) return;
        menu.classList.add("hidden");
    });

    menu.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-days]");
        if (!b) return;

        const raw = b.dataset.days;
        const val = (raw === "Infinity") ? Infinity : Number(raw);
        if (val !== Infinity && (!Number.isFinite(val) || val <= 0)) return;

        timeCapDays = val;
        saveTimeCapDays(val);

        updateTimeCapLabel();
        menu.classList.add("hidden");
        applyFilter();
    });

    return menu;
}

function openTimeMenu() {
    if (!btnTime) return;
    const menu = ensureTimeMenu();

    // mark active item
    Array.from(menu.querySelectorAll("button")).forEach((b) => {
        const raw = b.dataset.days;
        const val = (raw === "Infinity") ? Infinity : Number(raw);
        const active = (timeCapDays === Infinity && val === Infinity) || (val === timeCapDays);
        b.classList.toggle("active", active);
    });

    const r = btnTime.getBoundingClientRect();
    const top = r.bottom + 6;
    const left = Math.min(r.left, window.innerWidth - 190);

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    menu.classList.remove("hidden");
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
        showToolbarMessage("Could not load locations.json", "Check Network tab", 6000);
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

let toolbarMsgTimer = null;

function buildShareSearchUrl(searchText) {
    // Prefer "https://lizard43.com/adster?s=..." (no index.html, no extra query)
    const u = new URL(window.location.href);

    // strip any existing query/hash
    u.search = "";
    u.hash = "";

    // normalize pathname: remove trailing "index.html" and trailing slash
    u.pathname = u.pathname.replace(/\/index\.html$/i, "");
    u.pathname = u.pathname.replace(/\/$/, "");

    const s = String(searchText ?? "").trim();
    if (!s) return u.toString();

    u.searchParams.set("s", s); // URLSearchParams handles encoding
    return u.toString();
}

async function copyTextToClipboard(text) {
    // Modern clipboard API
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    // Fallback (older iOS/Safari)
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.select();

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
}

function showToolbarMessage(line1, line2 = "", duration = 4000) {
    if (!toolbarMsg || !toolbarMsgLine1 || !toolbarMsgLine2) return;

    // Set text
    toolbarMsgLine1.textContent = String(line1 ?? "");
    toolbarMsgLine2.textContent = String(line2 ?? "");

    // Show/hide based on content
    const hasAny = !!(toolbarMsgLine1.textContent.trim() || toolbarMsgLine2.textContent.trim());
    toolbarMsg.classList.toggle("hidden", !hasAny);

    // Reset timer
    if (toolbarMsgTimer) {
        clearTimeout(toolbarMsgTimer);
        toolbarMsgTimer = null;
    }

    if (!hasAny) return;

    toolbarMsgTimer = setTimeout(() => {
        toolbarMsgLine1.textContent = "";
        toolbarMsgLine2.textContent = "";
        toolbarMsg.classList.add("hidden");
        toolbarMsgTimer = null;
    }, duration);
}

function showToast(message, duration = 5000) {
    // Route all legacy toasts into the toolbar status (line 1)
    showToolbarMessage(message, "", duration);
}

// ---- simple toast helper for status messages (e.g., chosen location) ----
function showToaster(message, duration = 4000) {
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

function setupFavoriteSearchHearts() {
    const wrapper = document.getElementById("favSearchWrapper");
    if (!wrapper) return;

    const buttons = Array.from(wrapper.querySelectorAll(".favsearch-btn[data-slot]"));

    function flash(btn) {
        btn.classList.add("saved-flash");
        setTimeout(() => btn.classList.remove("saved-flash"), 250);
    }

    function render() {
        for (const btn of buttons) {
            const slot = Number(btn.dataset.slot);
            const stored = loadFavSearch(slot);

            btn.classList.toggle("active", !!stored.trim());
            btn.title = stored.trim()
                ? `Favorite search ${slot}: ${stored} (click to recall, hold to overwrite / clear)`
                : `Favorite search ${slot} (empty) — hold to save current search`;
        }
    }

    function recall(slot) {
        const stored = loadFavSearch(slot);
        if (!stored.trim()) return; // click does nothing when empty/grey

        // QoL: if the current search already matches the slot, treat a tap as "clear search"
        // (same effect as clicking the X at the right side of the search box).
        const current = String(searchInput.value ?? "").trim();
        if (current && current === String(stored).trim()) {
            clearSearchBox({ focus: true });
            return;
        }

        searchInput.value = stored;
        applyFilterNextFrame();
        searchInput.focus();
    }

    function saveOrClear(slot) {
        const current = String(searchInput.value ?? "");
        const btn = buttons.find(b => Number(b.dataset.slot) === slot);

        if (!current.trim()) {
            saveFavSearch(slot, "");
            render();
            if (btn) flash(btn);
            showToast(`Favorite ${slot} cleared`);
            return;
        }

        saveFavSearch(slot, current);
        render();
        if (btn) flash(btn);
        showToast(`Favorite ${slot} saved`);
    }

    // pointer-based click vs long-press (same hybrid pattern you used for Distance/Price)
    const LONG_PRESS_MS = 450;

    for (const btn of buttons) {
        let pressTimer = null;
        let longPressFired = false;

        const slot = Number(btn.dataset.slot);

        btn.addEventListener("pointerdown", (e) => {
            longPressFired = false;
            pressTimer = setTimeout(() => {
                longPressFired = true;
                console.log(
                    "[favsearch] long-press",
                    "slot =", slot,
                    "search =", JSON.stringify(searchInput.value)
                );
                saveOrClear(slot);
            }, LONG_PRESS_MS);

            btn.setPointerCapture?.(e.pointerId);
        });

        const clear = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };

        btn.addEventListener("pointerup", (e) => {
            clear();

            if (longPressFired) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            recall(slot);
        });

        btn.addEventListener("pointercancel", clear);
        btn.addEventListener("pointerleave", clear);

        // prevent long-press context menu from stealing the gesture
        btn.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
        });

    }

    // initial render
    render();

    // OPTIONAL: re-render on page visibility changes (keeps it correct if storage changes elsewhere)
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) render();
    });
}

async function resolveHomeLocation() {
    const s = getLocSettings();
    const locations = await loadLocationsJson();

    if (s.mode === "fixed") {
        const fixed = resolveFixedLocation(locations, s.fixedId, s.userLat, s.userLon);
        homeLat = fixed.lat;
        homeLon = fixed.lon;
        lastLocationToastText = `Location: ${fixed.why}`;

        return;
    }

    // mode === "browser"
    const geo = await getBrowserLatLon();
    if (geo) {
        homeLat = geo.lat;
        homeLon = geo.lon;
        lastLocationToastText = `Location: browser (${homeLat.toFixed(4)}, ${homeLon.toFixed(4)})`;
        return;
    }

    // fallback to fixed selection
    const fbId = s.fallbackId || s.fixedId; // if not set, reuse fixed
    const fixed = resolveFixedLocation(locations, fbId, s.userLat, s.userLon);
    homeLat = fixed.lat;
    homeLon = fixed.lon;
    lastLocationToastText = `Location: browser failed → ${fixed.why}`;
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

function formatLocal12h(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return "";

    // Build a stable, friendly string without locale-inserted punctuation quirks.
    // Example: "Jan 19, 2026 3:04 PM"
    try {
        const parts = new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        }).formatToParts(d);

        const get = (type) => (parts.find((p) => p.type === type)?.value || "");

        const month = get("month");
        const day = get("day");
        const year = get("year");
        const hour = get("hour");
        const minute = get("minute");
        const dayPeriod = (get("dayPeriod") || "").toUpperCase();

        if (!month || !day || !year || !hour || !minute) return "";
        return `${month} ${day}, ${year} ${hour}:${minute} ${dayPeriod}`.trim();
    } catch {
        return "";
    }
}

function formatTimestampDisplay(ts) {
    if (!ts) return "";

    const d = new Date(ts);
    if (isNaN(d.getTime())) {
        return String(ts);
    }

    const pretty = formatLocal12h(d);
    if (pretty) return pretty;

    // Very old browsers: fall back to a basic formatter
    const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    const year = d.getFullYear();
    const monthName = months[d.getMonth()];
    const day = d.getDate();

    let hour = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;

    return `${monthName} ${day}, ${year} ${hour}:${minutes} ${ampm}`;
}

function formatTitleTimestamp(ts) {
    if (!ts) return "";

    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);

    const pretty = formatLocal12h(d);
    return pretty || formatTimestampDisplay(ts);
}

function getDateFilterMs() {
    return Number.isFinite(dateFilterMs) ? dateFilterMs : null;
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
    const field = getEffectiveSortField();
    const effectiveDir = getEffectiveSortDir();
    const dir = effectiveDir === "desc" ? -1 : 1;

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

            return effectiveDir === "desc" ? vb - va : va - vb;
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
        const titleAttr = escapeAttr(title);

        const titleHtml = adUrl
            ? `<a href="${adUrl}" target="_blank" rel="noopener noreferrer" title="${titleAttr}">${escapeHtml(title)}</a>`
            : `<span title="${titleAttr}">${escapeHtml(title)}</span>`;

        // Seller (line 2 right side)
        const authorHtml = author
            ? (authorUrl
                ? `<a href="${authorUrl}" target="_blank" rel="noopener noreferrer" class="ad-author-link">${escapeHtml(author)}</a>`
                : `<span class="ad-author-text">${escapeHtml(author)}</span>`)
            : `<span class="ad-author-text"></span>`;

        // Distance text (line 3 left side)
        const distanceText = distance
            ? `<span class="distance-value">${escapeHtml(String(distance))}</span><span class="distance-unit"> mi</span>`
            : "";

        // Image (left column)
        const serverMissing = !!ad.imageMissing;
        const urlMissing = !imageUrl;

        const alreadyFailedThisSnapshot = badImageIdSet.has(adID);
        const isImageMissing = serverMissing || urlMissing || alreadyFailedThisSnapshot;

        const wrapLink = (innerHtml) => {
            return adUrl
                ? `<a href="${adUrl}" target="_blank" rel="noopener noreferrer">${innerHtml}</a>`
                : innerHtml;
        };

        const imgHtml = isImageMissing
            ? wrapLink(`<div class="thumb-fallback" title="Image missing">No image</div>`)
            : (imageUrl
                ? wrapLink(`<img class="ad-thumb" src="${imageUrl}" alt="" loading="lazy" decoding="async">`)
                : wrapLink(`<div class="thumb-fallback" title="No image">No image</div>`));

        // Hide/show action
        let hideShowIconHtml, hideShowAction, hideShowTitle;

        const ICON_EYE = `
  <svg viewBox="0 0 24 24" class="icon-svg" focusable="false" aria-hidden="true">
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`.trim();

        const ICON_X = `
  <svg viewBox="0 0 24 24" class="icon-svg" focusable="false" aria-hidden="true">
    <path d="M6 6l12 12"></path>
    <path d="M18 6L6 18"></path>
  </svg>
`.trim();

        if (isHidden) {
            hideShowIconHtml = ICON_EYE;
            hideShowAction = "show";
            hideShowTitle = "Unhide ad";
        } else {
            hideShowIconHtml = ICON_X;
            hideShowAction = "hide";
            hideShowTitle = "Hide ad";
        }

        // Description (line 4) — we escape so it can’t break the card HTML.
        // (Your CSS clamps it to a few lines.)
        const descSafe = escapeHtml(desc);

        return `
    <div class="ad-card ${isHidden ? "hidden-ad" : ""} ${isImageMissing ? "image-missing" : ""}"
         data-ad-id="${escapeAttr(adID)}"
         tabindex="0">

    <button class="icon-btn hide-toggle card-close"
            data-action="${hideShowAction}"
            data-ad-id="${escapeAttr(adID)}"
            title="${escapeAttr(hideShowTitle)}"
            aria-label="${escapeAttr(hideShowTitle)}">
    ${hideShowIconHtml}
    </button>

  <div class="ad-thumb-wrap">
    ${imgHtml}
  </div>

  <div class="ad-card-body">
    <div class="ad-line1">${titleHtml}</div>

    <div class="ad-line2">
    <span class="ad-price ${ad.priceChanged ? "price-changed" : ""}">${escapeHtml(price)}</span>
    ${ad.postedTime ? `<span class="meta-dot">·</span>` : ""}
    ${dateTimeHtml}
    </div>
    
    <div class="ad-line3">
    <span class="ad-distance">${distanceText}</span>
    ${location ? `<span class="meta-dot">·</span>` : ""}
    <span class="ad-location">${escapeHtml(location)}</span>
    </div>

    <div class="ad-line-adid">${escapeHtml(adID)}</div>

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
    const fieldNow = getEffectiveSortField();
    const dirNow = getEffectiveSortDir();
    const hasSortOverride = !!sortOverrideField;

    buttons.forEach((btn) => {
        const f = btn.getAttribute("data-field");
        const span = btn.querySelector(".sort-indicator");
        if (!span) return;

        if (f === fieldNow) {
            span.textContent = dirNow === "asc" ? "▲" : "▼";
            btn.classList.add("active");
        } else {
            span.textContent = "";
            btn.classList.remove("active");
        }

        // Search bar sort override: outline ONLY the active sort pill.
        // (Cap override outline for Distance/Price/Time is handled elsewhere.)
        if (hasSortOverride) {
            btn.classList.toggle("override-active", f === fieldNow);
        } else {
            // Don't clobber cap outlines for Distance/Price/Time.
            if (f !== "distance" && f !== "price" && f !== "postedTime") {
                btn.classList.remove("override-active");
            }
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
const WILDCARD_MAX_GAP = 5; // chars between fragments when '*' is used

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

    // 2) blob regex: '*' matches up to WILDCARD_MAX_GAP chars INCLUDING spaces/hyphens/underscores
    //    but each fragment must start at a word boundary
    const parts = term.split("*").filter(Boolean).map(escapeRegExpLiteral);

    const blobGap = `[\\s\\-_a-z0-9]{0,${WILDCARD_MAX_GAP}}`;

    let blobPattern = "";
    for (let i = 0; i < parts.length; i++) {
        if (i > 0) blobPattern += blobGap;
        blobPattern += `\\b${parts[i]}`;
    }
    const blobRe = new RegExp(blobPattern);

    // 3) NEW: "squashed" regex (alnum only) to allow inside-word matches like "quietbert"
    // Only enable when there are at least 2 fragments, otherwise it can create surprises.
    let squashRe = null;
    if (parts.length >= 2) {
        const squashGap = `[a-z0-9]{0,${WILDCARD_MAX_GAP}}`;
        let squashPattern = "";
        for (let i = 0; i < parts.length; i++) {
            if (i > 0) squashPattern += squashGap;
            squashPattern += parts[i];
        }
        squashRe = new RegExp(squashPattern);
    }

    const pair = { tokenRe, blobRe, squashRe };
    _wildcardRegexCache.set(key, pair);
    return pair;
}

function matchTermInBlob(term, blob) {
    if (!term) return true;

    // Non-wildcard: fast path
    if (!term.includes("*")) return blob.includes(term);

    const { tokenRe, blobRe, squashRe } = termToRegexPair(term);

    // 1) token-level match (catches "neogeo", "ms-pacman", "qbert", etc.)
    const tokens = blob.split(/[^a-z0-9-]+/i).filter(Boolean);
    for (const tok of tokens) {
        if (tokenRe.test(tok)) return true;
    }

    // 2) blob-level match (allows crossing spaces/hyphens/underscores within WILDCARD_MAX_GAP)
    if (blobRe.test(blob)) return true;

    // 3) squashed match (allows inside-word matches like quietbert)
    if (squashRe) {
        const blobSquash = blob.replace(/[^a-z0-9]+/g, "");
        if (squashRe.test(blobSquash)) return true;
    }

    return false;
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

function computePriceChangedCount(list) {
    if (!Array.isArray(list) || !list.length) return 0;

    let n = 0;
    for (const ad of list) {
        if (!ad) continue;

        // Exclude hidden ONLY when both:
        // - showHidden is OFF
        // - includeHiddenInSearch is OFF
        if (ad.hidden && !showHidden && !includeHiddenInSearch) continue;

        if (ad.priceChanged) n++;
    }
    return n;
}

function renderPriceChangedToggle() {
    if (!btnPriceChanged) return;
    btnPriceChanged.classList.toggle("active", !!showOnlyPriceChanged);
    btnPriceChanged.title = showOnlyPriceChanged
        ? "Showing only price-changed ads"
        : "Show only price-changed ads";
}

function updatePriceChangedBadge() {
    if (!priceChangedBadge) return;

    const count = computePriceChangedCount(filteredAds);

    const full = String(count);
    const shown = (full.length <= 2) ? full : full.slice(0, 2);

    priceChangedBadge.textContent = shown;

    // Tooltip shows the real number if it's bigger than 2 digits
    priceChangedBadge.title = full;
}

function updateSearchPlaceholder() {
    if (!searchInput) return;

    const base = "Search title, description, location, author…";

    if (!generatedAtISO) {
        searchInput.placeholder = base;
        return;
    }

    const pretty = formatTimestampDisplay(generatedAtISO);
    searchInput.placeholder = `${base}\nLast scrape: ${pretty}`;
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

    const gen = generatedAtISO ? formatTimestampDisplay(generatedAtISO) : "";
    if (gen) resultsPill.title += ` • Last scrape: ${gen}`;
    resultsPill.title += " • Tap to refresh";

    // "active" look if any filtering is happening
    const hasSearch = !!(searchInput && searchInput.value && searchInput.value.trim());
    const hasDate = (getDateFilterMs() !== null);
    const hasDistanceCap = (typeof distanceCapMiles === "number" && distanceCapMiles !== Infinity);
    const hasPriceCap = (typeof priceCapDollars === "number" && Number.isFinite(priceCapDollars) && priceCapDollars > 0);
    const hasHiddenFiltering = (!showHidden && !includeHiddenInSearch);

    const isActive = hasSearch || hasDate || hasDistanceCap || hasPriceCap || hasHiddenFiltering;
    resultsPill.classList.toggle("active", isActive);
}

// --- filter logic ---

function parseCapOverridesFromSearch(rawInput) {
    // Supports:
    //   distancecap:1000
    //   distcap:250
    //   dcap:Infinity / dcap:any
    //   pricecap:500
    //   pcap:$1,500 / pcap:any / pcap:inf
    //
    // Returns:
    //   { cleanedRaw, distanceOverrideMiles, priceOverrideDollars }

    const out = {
        cleanedRaw: String(rawInput ?? ""),
        distanceOverrideMiles: null, // null = no override
        priceOverrideDollars: null,  // null = no override
        timeOverrideDays: null,      // null = no override
        // { field: "distance"|"postedTime"|"price", dir: "asc"|"desc" } or null
        sortOverride: null,
    };

    let s = out.cleanedRaw;

    function parseMaybeInfinity(v) {
        const t = String(v ?? "").trim().toLowerCase();
        if (!t) return null;
        if (t === "any" || t === "inf" || t === "infinity" || t === "max") return Infinity;
        return null;
    }

    function parseNumberLoose(v) {
        // Accept "$1,500", "1500", "1500mi", "1,000"
        const m = String(v ?? "").match(/[\d,.]+/);
        if (!m) return NaN;
        return Number(String(m[0]).replace(/,/g, ""));
    }

    function parseTimeDaysToken(v) {
        const t = String(v ?? "").trim().toLowerCase();
        if (!t) return null;

        if (t === "any" || t === "inf" || t === "infinity" || t === "max") return Infinity;
        if (t === "1mo" || t === "1m" || t === "1month" || t === "month" || t === "mo") return 30;
        if (t === "3mo" || t === "3m" || t === "3months") return 90;
        if (t === "6mo" || t === "6m" || t === "6months") return 180;

        const md = t.match(/^(\d+)(d|day|days)$/i);
        if (md) {
            const n = Number(md[1]);
            if (Number.isFinite(n) && n > 0) return n;
        }

        return null;
    }

    // 1) distancecap directives
    s = s.replace(/(^|\s)(d|dist|distance|distancecap|distcap|dcap)\s*:\s*([^\s&|()!]+)/gi, (full, lead, _k, val) => {
        const inf = parseMaybeInfinity(val);
        if (inf === Infinity) out.distanceOverrideMiles = Infinity;
        else {
            const n = parseNumberLoose(val);
            if (Number.isFinite(n) && n > 0) out.distanceOverrideMiles = n;
        }
        return lead; // remove directive, keep whitespace leader
    });

    // 2) pricecap directives
    s = s.replace(/(^|\s)(p|price|pricecap|pcap)\s*:\s*([^\s&|()!]+)/gi, (full, lead, _k, val) => {
        const inf = parseMaybeInfinity(val);
        if (inf === Infinity) out.priceOverrideDollars = Infinity;
        else {
            const n = parseNumberLoose(val);
            if (Number.isFinite(n) && n >= 0) out.priceOverrideDollars = n;
        }
        return lead;
    });

    // 3) timecap directives
    s = s.replace(/(^|\s)(t|time|timecap|tcap)\s*:\s*([^\s&|()!]+)/gi, (full, lead, _k, val) => {
        const days = parseTimeDaysToken(val);
        if (days !== null) out.timeOverrideDays = days;
        return lead;
    });

    // 4) sort directives
    // Supported:
    //   s:da (distance asc) / s:dd (distance desc)
    //   s:ta (time asc)     / s:td (time desc)
    //   s:pa (price asc)    / s:pd (price desc)
    s = s.replace(/(^|\s)(s|sort)\s*:\s*(da|dd|ta|td|pa|pd)\b/gi, (full, lead, _k, codeRaw) => {
        const code = String(codeRaw || "").toLowerCase();

        const map = {
            da: { field: "distance", dir: "asc" },
            dd: { field: "distance", dir: "desc" },
            ta: { field: "postedTime", dir: "asc" },
            td: { field: "postedTime", dir: "desc" },
            pa: { field: "price", dir: "asc" },
            pd: { field: "price", dir: "desc" },
        };

        if (map[code]) out.sortOverride = map[code];
        return lead;
    });

    // Cleanup: removing directives can leave "donkey &  &" etc.
    // - collapse spaces
    // - collapse repeated operators
    // - trim dangling leading/trailing operators
    s = s.replace(/\s+/g, " ").trim();

    // collapse repeated operators (e.g. "& &", "| |", "& |")
    s = s.replace(/(\&\&|\&|\|\||\|)\s*(\&\&|\&|\|\||\|)+/g, "$1");

    // remove leading operators
    while (/^(\&\&|\&|\|\||\|)\b/.test(s)) s = s.replace(/^(\&\&|\&|\|\||\|)\s*/g, "").trim();

    // remove trailing operators
    while (/\b(\&\&|\&|\|\||\|)$/.test(s)) s = s.replace(/\s*(\&\&|\&|\|\||\|)$/g, "").trim();

    out.cleanedRaw = s;
    return out;
}

function applyFilter() {
    const rawInput = searchInput.value;   // keep exact user input
    const quickFilterMs = getDateFilterMs();

    // Pull out temporary cap overrides from the search text
    const overrides = parseCapOverridesFromSearch(rawInput);

    // Sort override (search bar): affects sorting + sort indicators, but does not mutate
    // the user's manually-selected sortField/sortDir.
    if (overrides.sortOverride) {
        sortOverrideField = overrides.sortOverride.field;
        sortOverrideDir = overrides.sortOverride.dir;
    } else {
        sortOverrideField = null;
        sortOverrideDir = null;
    }

    // UI: show red outline on the cap buttons when search overrides are present
    if (btnDistance) {
        btnDistance.classList.toggle("override-active", overrides.distanceOverrideMiles !== null);
    }
    if (btnPrice) {
        btnPrice.classList.toggle("override-active", overrides.priceOverrideDollars !== null);
    }
    const quickTimeActive = (activeQuickRange !== -1);

    // Time pill is "overridden" if:
    // - search directive tcap:... is present, OR
    // - a quick toolbar time filter is active
    if (btnTime) {
        btnTime.classList.toggle(
            "override-active",
            (overrides.timeOverrideDays !== null) || quickTimeActive
        );
    }

    // UI: while overridden, TEMP show the overridden value in the pill label.
    // When override clears, revert to the real stored cap value.
    if (distanceCapLabel) {
        const v = (overrides.distanceOverrideMiles !== null)
            ? overrides.distanceOverrideMiles
            : distanceCapMiles;
        distanceCapLabel.textContent = capToLabel(v);
    }

    if (priceCapLabel) {
        const v = (overrides.priceOverrideDollars !== null)
            ? overrides.priceOverrideDollars
            : priceCapDollars;
        priceCapLabel.textContent = priceToLabel(v);
    }

    if (timeCapLabel) {
        // Priority:
        // 1) search directive override (tcap:...)
        // 2) quick toolbar time filter (4h/12h/1d/1w)
        // 3) stored time cap menu selection
        let v = timeCapDays;

        if (overrides.timeOverrideDays !== null) {
            v = overrides.timeOverrideDays;
        } else if (quickTimeActive) {
            // mirror your toolbar options by activeQuickRange
            if (activeQuickRange === 0) v = 4 / 24;      // 4h
            else if (activeQuickRange === 1) v = 12 / 24; // 12h
            else if (activeQuickRange === 2) v = 1;       // 1d
            else if (activeQuickRange === 3) v = 7;       // 1w
        }

        timeCapLabel.textContent = timeCapToLabel(v);
    }

    // Cleaned search text (directives removed) drives matching
    const raw = overrides.cleanedRaw;
    const qTrim = raw.trim();
    const q = raw.toLowerCase();

    // Effective caps: override if present, else current toolbar caps
    const effectiveDistanceCap =
        (overrides.distanceOverrideMiles !== null) ? overrides.distanceOverrideMiles : distanceCapMiles;

    const effectivePriceCap =
        (overrides.priceOverrideDollars !== null) ? overrides.priceOverrideDollars : priceCapDollars;

    const effectiveTimeCapDays =
        (overrides.timeOverrideDays !== null) ? overrides.timeOverrideDays : timeCapDays;

    // Combine quick-range cutoff and cap cutoff (tightest / most recent wins)
    let filterMs = null;
    if (Number.isFinite(quickFilterMs)) {
        filterMs = quickFilterMs;
    }
    if (effectiveTimeCapDays !== Infinity && Number.isFinite(effectiveTimeCapDays) && effectiveTimeCapDays > 0) {
        const capMs = Date.now() - (effectiveTimeCapDays * 24 * 60 * 60 * 1000);
        filterMs = (filterMs === null) ? capMs : Math.max(filterMs, capMs);
    }

    const prepareBlob = (ad) => {
        const imgToken = (badImageIdSet.has(ad?.adID || "") || !!ad?.imageMissing) ? " img:missing" : "";
        return (
            [
                ad.title,
                ad.price,
                ad.description,
                ad.location,
                ad.author,
                ad.source,
                ad.adID,
                ad.adID ? `id:${ad.adID}` : "",
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase() + imgToken
        );
    };

    let matcher;

    if (!qTrim) {
        matcher = (ad) => true;
    } else {
        const isBooleanMode = /[&|()!]/.test(qTrim.toLowerCase());

        if (!isBooleanMode) {
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
        // - showHidden (settings) shows all hidden regardless of search
        // - includeHiddenInSearch (new toggle) allows hidden to participate in search+filters
        if (ad.hidden && !showHidden && !includeHiddenInSearch) return false;

        // text / boolean condition
        if (!matcher(ad)) return false;

        // date/time condition (if set)
        if (filterMs !== null) {
            if (!ad.postedTime) return false;
            const t = new Date(ad.postedTime).getTime();
            if (!Number.isFinite(t) || t < filterMs) return false;
        }

        // distance cap (effective)
        if (effectiveDistanceCap !== Infinity) {
            const d = normalizeDistance(ad.distance);
            if (!Number.isFinite(d)) return false;
            if (d > effectiveDistanceCap) return false;
        }

        // price cap (effective max price)
        if (effectivePriceCap !== Infinity && Number.isFinite(effectivePriceCap) && effectivePriceCap >= 0) {
            const p = normalizePrice(ad.price);
            if (!Number.isFinite(p)) return false;
            if (p > effectivePriceCap) return false;
        }

        return true;
    });

    // Badge count is based on "current ad list with filtering" (and showHidden rules)
    updatePriceChangedBadge();

    // Apply the extra toggle filter AFTER we compute badge count
    if (showOnlyPriceChanged) {
        filteredAds = filteredAds.filter((ad) => {
            if (ad.hidden && !showHidden && !includeHiddenInSearch) return false;
            return !!ad.priceChanged;
        });
    }

    renderTable();
    updateResultsPill();
}

// --- search & clear events ---

function updateQuickRangeButtons() {
    const btns = [btnLast4h, btnLast12h, btnLast1d, btnLast1w];
    btns.forEach((btn, idx) => {
        if (!btn) return;
        if (idx === activeQuickRange) btn.classList.add("active");
        else btn.classList.remove("active");
    });
}

function setFilterRelativeHoursToggle(idx, hoursBack) {
    if (activeQuickRange === idx) {
        activeQuickRange = -1;
        dateFilterMs = null;
        applyFilter();
        updateQuickRangeButtons();
        return;
    }

    activeQuickRange = idx;
    const now = Date.now();
    dateFilterMs = now - (hoursBack * 60 * 60 * 1000);

    applyFilter();
    updateQuickRangeButtons();
}

if (resultsPill) {
    resultsPill.style.cursor = "pointer";
    resultsPill.title = (resultsPill.title ? (resultsPill.title + " • ") : "") + "Tap to refresh";

    resultsPill.addEventListener("click", () => {
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
if (btnLast1w) {
    btnLast1w.addEventListener("click", () => setFilterRelativeHoursToggle(3, 168));
}

searchInput.addEventListener("input", () => {
    autosizeSearchBox();

    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        applyFilter();
    }, SEARCH_DEBOUNCE_MS);
});

searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
    }
});

clearSearch.addEventListener("click", () => {
    clearSearchBox({ focus: true });
});

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

        // update local model (avoid rebuilding the whole array)
        if (Array.isArray(allAds)) {
            for (let i = 0; i < allAds.length; i++) {
                const ad = allAds[i];
                if (ad?.adID === adID) {
                    ad.hidden = hidden ? 1 : 0;
                    break;
                }
            }
        }

        // --- PERF: avoid full-grid re-render on every hide click ---
        const card = tbody?.querySelector(`.ad-card[data-ad-id="${CSS.escape(adID)}"]`);

        if (card) {
            if (hidden && !showHidden) {
                // If "include hidden in search" is OFF, hidden ads must disappear immediately.
                // If it's ON, they should remain visible (dimmed) even though showHidden is off.
                if (!includeHiddenInSearch) {
                    // Remove from DOM + filteredAds, then update counts (including price badge).
                    card.remove();
                    if (Array.isArray(filteredAds)) {
                        filteredAds = filteredAds.filter((a) => a?.adID !== adID);
                    }
                } else {
                    // Keep it visible but dimmed (hidden-ad class already handled below).
                    card.classList.add("hidden-ad");

                    // Also flip the top-right icon to the "eye" so the user can unhide
                    // the card without needing to re-render the whole grid.
                    const btn = card.querySelector("button.hide-toggle[data-action]");
                    if (btn) {
                        const ICON_EYE = `
  <svg viewBox="0 0 24 24" class="icon-svg" focusable="false" aria-hidden="true">
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`.trim();

                        btn.dataset.action = "show";
                        btn.title = "Unhide ad";
                        btn.setAttribute("aria-label", "Unhide ad");
                        btn.innerHTML = ICON_EYE;
                    }
                }

                updatePriceChangedBadge();
                updateResultsPill();
                return;
            }

            // Update this one card’s UI (classes + hide/show button)
            card.classList.toggle("hidden-ad", !!hidden);

            const btn = card.querySelector("button.hide-toggle[data-action]");
            if (btn) {
                const ICON_EYE = `
  <svg viewBox="0 0 24 24" class="icon-svg" focusable="false" aria-hidden="true">
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`.trim();

                const ICON_X = `
  <svg viewBox="0 0 24 24" class="icon-svg" focusable="false" aria-hidden="true">
    <path d="M6 6l12 12"></path>
    <path d="M18 6L6 18"></path>
  </svg>
`.trim();

                if (hidden) {
                    btn.dataset.action = "show";
                    btn.title = "Unhide ad";
                    btn.setAttribute("aria-label", "Unhide ad");
                    btn.innerHTML = ICON_EYE;
                } else {
                    btn.dataset.action = "hide";
                    btn.title = "Hide ad";
                    btn.setAttribute("aria-label", "Hide ad");
                    btn.innerHTML = ICON_X;
                }
            }

            updateResultsPill();
            return;
        }

        // Fallback: if the card isn't in the DOM, do the normal pipeline.
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
        try {
            // Save settings from the modal (fixed location, etc.)
            syncStorageFromUI();

            close();

            // Re-apply location-dependent behavior
            await resolveHomeLocation();
            await loadAds();

            showToast("Settings saved");
        } catch (err) {
            console.error("[settings] save failed:", err);
            showToast("Settings save failed (see console)", 6000);
        }
    });
}

btnHiddenSearch?.addEventListener("click", () => {
    includeHiddenInSearch = !includeHiddenInSearch;
    saveIncludeHiddenInSearch(includeHiddenInSearch);
    renderHiddenSearchToggle();
    applyFilter();
    showToast(includeHiddenInSearch
        ? "Hidden ads included in filtering"
        : "Hidden ads excluded from filtering"
    );
});

btnPriceChanged?.addEventListener("click", () => {
    showOnlyPriceChanged = !showOnlyPriceChanged;
    renderPriceChangedToggle();

    // When enabling the filter, force a sensible view:
    // sort by price (lowest first) and jump to top.
    if (showOnlyPriceChanged) {
        sortField = "price";
        sortDir = "asc"; // lowest first
    }

    applyFilter();
    scrollResultsToTop();
});

btnCheapo?.addEventListener("click", async () => {
    cheapoMode = !cheapoMode;
    saveCheapoMode(cheapoMode);
    renderCheapoToggle();

    // Switch dataset and reload.
    ADS_JSON_URL = resolveAdsJsonUrlFromQuery();
    await loadAds();

    showToast(cheapoMode ? "Cheapo ON" : "Cheapo OFF");
});

btnShare?.addEventListener("click", async () => {
    try {
        const url = buildShareSearchUrl(searchInput.value);

        // Prefer native share sheet if available
        if (navigator.share) {
            try {
                // Include some context text (optional but nice in Messages/Mail)
                const text = searchInput.value && searchInput.value.trim()
                    ? `Adster search: ${searchInput.value.trim()}`
                    : "Adster";

                await navigator.share({ url, text });
                return; // user shared (or at least the sheet opened)
            } catch (e) {
                // If user cancels share sheet, do nothing (no fallback spam)
                if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) {
                    return;
                }
                // Otherwise, fall through to clipboard fallback
                console.warn("[share] navigator.share failed, falling back to copy:", e);
            }
        }

        // Fallback: copy to clipboard
        await copyTextToClipboard(url);

        btnShare.classList.add("saved-flash");
        setTimeout(() => btnShare.classList.remove("saved-flash"), 250);

        showToast("Copied");
    } catch (err) {
        console.error("[share] failed:", err);
        showToast("Share failed (see console)", 5000);
    }
});

tbody.addEventListener("pointerdown", (e) => {
    const card = e.target.closest(".ad-card");
    if (card) card.focus();
});

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

            // --- PERF: update the single button instead of re-rendering every card ---
            btn.classList.toggle("active", favoriteIdSet.has(adID));
            btn.textContent = favoriteIdSet.has(adID) ? "♥" : "♡";
            btn.title = favoriteIdSet.has(adID) ? "Unfavorite" : "Favorite";
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
        updateSearchPlaceholder();

        syncBadImageSetWithGeneratedAt(generatedAtISO);

        if (generatedAtISO) {
            const titleTime = formatTitleTimestamp(generatedAtISO);
            document.title = titleTime
                ? `Adster · ${titleTime}`
                : "Adster";

            if (lastLocationToastText) {
                showToolbarMessage(lastLocationToastText, "", 3000);
            }
        }

        // if (generatedAtISO) {
        //     const titleTime = formatTitleTimestamp(generatedAtISO);
        //     document.title = titleTime
        //         ? `Adster · ${titleTime}`
        //         : "Adster";

        //     const loc = lastLocationToastText || "Location: unknown";
        //     showToolbarMessage(loc, `Last scrape: ${titleTime}`, 3000);
        // }

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
    if (f === "distance") return;    // handled by hybrid handler below
    if (f === "price") return;       // handled by hybrid handler below
    if (f === "postedTime") return;  // handled by time hybrid handler below

    btn.addEventListener("click", () => {
        if (!f) return;

        if (f === sortField) {
            sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
            sortField = f;
            sortDir = SORT_DEFAULT_DIR[f] || "asc";
        }

        renderTable();
        scrollResultsToTop();
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
    scrollResultsToTop();
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
    scrollResultsToTop();
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

function sortByTimeClick() {
    const f = "postedTime";
    if (f === sortField) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
        sortField = f;
        sortDir = SORT_DEFAULT_DIR[f] || "desc";
    }
    renderTable();
    scrollResultsToTop();
}

(function setupTimeHybrid() {
    if (!btnTime) return;

    let pressTimer = null;
    let longPressFired = false;

    const LONG_PRESS_MS = 450;

    btnTime.addEventListener("pointerdown", (e) => {
        longPressFired = false;
        pressTimer = setTimeout(() => {
            longPressFired = true;
            openTimeMenu();
        }, LONG_PRESS_MS);

        btnTime.setPointerCapture?.(e.pointerId);
    });

    const clear = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    };

    btnTime.addEventListener("pointerup", (e) => {
        clear();

        // if menu opened, don't sort
        if (longPressFired) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        sortByTimeClick();
    });

    btnTime.addEventListener("pointercancel", clear);
    btnTime.addEventListener("pointerleave", clear);

    // prevent long-press context menu from stealing the gesture
    btnTime.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
    });
})();

function setupBrokenImageHandler() {
    if (!tbody) return;

    // Capture phase is required because <img> "error" doesn't bubble
    tbody.addEventListener("error", (e) => {
        const img = e.target;
        if (!img || img.tagName !== "IMG") return;
        if (!img.classList.contains("ad-thumb")) return;

        const card = img.closest(".ad-card");
        const adID = card?.getAttribute("data-ad-id") || "";
        if (!adID) return;

        // Record once, avoid loops / spam
        if (!badImageIdSet.has(adID)) {
            badImageIdSet.add(adID);
            saveBadImageIds(badImageIdSet);
            console.warn("[badimg] image failed; marked adID:", adID);
        }

        // Replace only the thumb DOM (cheap)
        const wrap = img.closest(".ad-thumb-wrap");
        if (wrap) {
            wrap.classList.add("thumb-broken");
            const adUrl = allAds?.find(a => String(a?.adID || "") === String(adID || ""))?.adUrl || "";
            wrap.innerHTML = adUrl
                ? `<a href="${adUrl}" target="_blank" rel="noopener noreferrer">
                    <div class="thumb-fallback" title="Image unavailable">No image</div>
                    </a>`
                : `<div class="thumb-fallback" title="Image unavailable">No image</div>`;
        }

        // --- PERF: do NOT full re-render here ---
        card?.classList.add("image-missing");

    }, true);
}

function applySearchFromUrlOnce() {
    try {
        const sp = new URLSearchParams(window.location.search);
        if (!sp.has("s")) return false;

        // URLSearchParams already decodes percent-encoding.
        let s = String(sp.get("s") || "");

        // Support optional quotes: ?s="foo bar"
        s = s.trim();
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            s = s.slice(1, -1);
        }

        if (!s.trim()) return false;

        searchInput.value = s;
        autosizeSearchBox();
        return true;
    } catch {
        return false;
    }
}

// initial load
(async function init() {
    await loadSettings();        // get favorites → render hearts
    await setupSettingsModal();

    setupBrokenImageHandler();
    setupFavoriteSearchHearts();

    // showHidden init (from settings)
    showHidden = loadShowHidden();
    renderHiddenSearchToggle();

    renderPriceChangedToggle();
    updatePriceChangedBadge();

    // cheapo dataset init
    cheapoMode = loadCheapoMode();
    renderCheapoToggle();

    // distance cap init
    const stored = loadDistanceCap();
    distanceCapMiles = (stored >= 1000000) ? Infinity : stored;
    updateDistanceCapLabel();

    // price cap init
    priceCapDollars = loadPriceCap();
    updatePriceCapLabel();

    // time cap init
    timeCapDays = loadTimeCapDays();
    updateTimeCapLabel();

    await resolveHomeLocation(); // pick browser or fallback location (+ toast)

    // URL can force cheapo ON/OFF for this load; also persist it.
    try {
        const sp = new URLSearchParams(window.location.search);
        if (sp.has("cheapo")) {
            const raw = String(sp.get("cheapo") || "").trim();
            cheapoMode = (raw !== "0");
            saveCheapoMode(cheapoMode);
            renderCheapoToggle();
        }
    } catch { }

    ADS_JSON_URL = resolveAdsJsonUrlFromQuery();

    applySearchFromUrlOnce();

    await loadAds();

    autosizeSearchBox();

})();
