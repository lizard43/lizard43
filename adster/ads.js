const API_BASE_URL = "";
const ADS_JSON_URL = "scrapester.json";

let allAds = [];
let filteredAds = [];
let sortField = "postedTime";
let sortDir = "asc"; // or "desc"

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
const toggleHiddenBtn = document.getElementById("toggleHidden");

const metaIcon = document.getElementById("scrapeMetaIcon");

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
    const FALLBACK_LAT = 30.4983;
    const FALLBACK_LON = -86.1361; // 86.1361° W → negative

    // No geolocation API? Use fallback.
    if (!("geolocation" in navigator)) {
        homeLat = FALLBACK_LAT;
        homeLon = FALLBACK_LON;
        showToast(
            `Using fallback location: ${homeLat.toFixed(4)}, ${homeLon.toFixed(4)}`
        );
        return;
    }

    await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                homeLat = pos.coords.latitude;
                homeLon = pos.coords.longitude;
                showToast(
                    `Using browser location: ${homeLat.toFixed(4)}, ${homeLon.toFixed(4)}`
                );
                resolve();
            },
            (err) => {
                console.warn("Geolocation failed, using fallback:", err);
                homeLat = FALLBACK_LAT;
                homeLon = FALLBACK_LON;
                showToast(
                    `Using fallback location: ${homeLat.toFixed(4)}, ${homeLon.toFixed(4)}`
                );
                resolve();
            },
            {
                enableHighAccuracy: false,
                timeout: 5000,
                maximumAge: 600000,
            }
        );
    });
}

// helpers (price, distance, time, boolean search, etc.)

function normalizePrice(price) {
    if (!price) return NaN;
    const m = String(price).match(/[\d,.]+/);
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

        const va = (a[field] || "").toString().toLowerCase();
        const vb = (b[field] || "").toString().toLowerCase();
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
    });
}

function renderTable() {
    const container = tbody; // now a div.ads-grid
    const sorted = sortAds(filteredAds);

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
        const dateTimeText = formatTimestampDisplay(ad.postedTime);
        const price = ad.price || "";
        const imageUrl = ad.imageUrl || "";
        const adUrl = ad.adUrl || ad.AdUrl || "";
        const source = ad.source || "Other";
        const authorUrl = ad.authorUrl || "";
        const adID = ad.adID || "";

        const isHidden = !!ad.hidden;

        const titleHtml = adUrl
            ? `<a href="${adUrl}" target="_blank" rel="noopener noreferrer">${title}</a>`
            : `<span>${title}</span>`;

        const authorHtml = author
            ? (authorUrl
                ? `<a href="${authorUrl}" target="_blank" rel="noopener noreferrer" class="ad-author-link">${author}</a>`
                : `<span class="ad-author-text">${author}</span>`)
            : "";

        const distanceText = distance ? `${distance} mi` : "";

        let locationLine = "";
        if (distanceText && location) {
            // distance first, then location, with a trailing period
            locationLine = `${distanceText} • ${location}.`;
        } else if (distanceText) {
            locationLine = distanceText;
        } else {
            locationLine = location;
        }

        const descHtml = desc
            ? `<div class="ad-desc-row">${desc}</div>`
            : "";

        const imgHtml = imageUrl
            ? `<a href="${adUrl}" target="_blank" rel="noopener noreferrer">
                 <img class="ad-thumb" src="${imageUrl}" alt="">
               </a>`
            : "";

        // Actions: hide/delete OR show/delete depending on hidden state
        let hideShowLabel, hideShowAction, hideShowTitle;
        if (isHidden) {
            hideShowLabel = "👁";          // show
            hideShowAction = "show";
            hideShowTitle = "Unhide ad";
        } else {
            hideShowLabel = "🙈";          // hide
            hideShowAction = "hide";
            hideShowTitle = "Hide ad";
        }

        return `
      <div class="ad-card ${isHidden ? "hidden-ad" : ""}" data-ad-id="${adID}">
        <div class="ad-thumb-wrap">
          ${imgHtml}
        </div>

        <div class="ad-card-body">
          <div class="ad-title-row">
            ${titleHtml}
          </div>

            <div class="ad-meta-row">
            <span class="ad-price">${price}</span>
            <span class="ad-location-line">${locationLine}</span>
            </div>

            <div class="ad-sub-row">
            <span class="ad-datetime">${dateTimeText}</span>
            <span class="ad-author">${authorHtml}</span>
            </div>
            ${descHtml}
        </div>

        <div class="ad-card-footer">
          <span class="source-pill">${source}</span>
          <div class="ad-actions">
            <button class="icon-btn"
                    data-action="${hideShowAction}"
                    data-ad-id="${adID}"
                    title="${hideShowTitle}">
              ${hideShowLabel}
            </button>
            <button class="icon-btn"
                    data-action="delete"
                    data-ad-id="${adID}"
                    title="Delete ad">
              🗑
            </button>
          </div>
        </div>
      </div>
    `;
    });

    container.innerHTML = cardsHtml.join("");
    updateSortIndicators();
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

// ------- Boolean search helpers (AND / OR / NOT) -------
// (unchanged from your current file)

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
    return tokens;
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
            return blob.includes(node.value);
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

// --- filter logic (tweaked to respect showHidden) ---

function applyFilter() {
    const raw = searchInput.value.trim();
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
            ad.adUrl,
        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

    let matcher;

    if (!q) {
        matcher = (ad) => true;
    } else {
        const isBooleanMode = /[&|()!]/.test(q);

        if (!isBooleanMode) {
            matcher = (ad) => prepareBlob(ad).includes(q);
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
                matcher = (ad) => prepareBlob(ad).includes(q);
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

        return true;
    });

    renderTable();
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

// "show hidden" toggle button
if (toggleHiddenBtn) {
    toggleHiddenBtn.addEventListener("click", () => {
        showHidden = !showHidden;
        if (showHidden) {
            toggleHiddenBtn.classList.add("active");
            toggleHiddenBtn.title = "Hide hidden ads";
        } else {
            toggleHiddenBtn.classList.remove("active");
            toggleHiddenBtn.title = "Show hidden ads";
        }
        applyFilter();
    });
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
        const res = await fetch(API_BASE_URL + "/settings");
        if (!res.ok) throw new Error("HTTP " + res.status);

        const json = await res.json();
        const raw = json && json.settings ? json.settings : json;

        const favs = Array.isArray(raw.favorites) ? raw.favorites : [];
        favorites = favs;
        renderFavorites();
    } catch (err) {
        console.error("Failed to load settings:", err);
        favorites = [];
        renderFavorites();
    }
}

// --- hide/unhide + delete helpers ---

async function setAdHidden(adID, hidden) {
    try {
        const res = await fetch(`${API_BASE_URL}/ads/hide`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adID, hidden })
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        // update local model
        allAds = allAds.map((ad) =>
            ad.adID === adID ? { ...ad, hidden: hidden ? 1 : 0 } : ad
        );
        applyFilter();
    } catch (err) {
        console.error("Failed to set hidden:", err);
        // optionally show some UI error later
    }
}

async function deleteAd(adID) {
    try {
        const res = await fetch(`${API_BASE_URL}/ads/${encodeURIComponent(adID)}`, {
            method: "DELETE"
        });
        if (!res.ok) throw new Error("HTTP " + res.status);

        allAds = allAds.filter((ad) => ad.adID !== adID);
        applyFilter();
    } catch (err) {
        console.error("Failed to delete ad:", err);
    }
}

// event delegation for action buttons
tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const adID = btn.dataset.adId;
    if (!adID) return;

    if (action === "hide") {
        setAdHidden(adID, true);
    } else if (action === "show") {
        setAdHidden(adID, false);
    } else if (action === "delete") {
        deleteAd(adID);
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
        applyFilter();
    } catch (err) {
        console.error("Failed to load ads:", err);
        tbody.innerHTML = "Error loading ads.";
    }
}

// sort-bar button sorting
document.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const f = btn.getAttribute("data-field");
        if (!f) return;

        if (f === sortField) {
            sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
            sortField = f;
            sortDir = "asc";
        }
        renderTable();
    });
});

// initial load
(async function init() {
    await loadSettings();        // get favorites → render hearts
    await resolveHomeLocation(); // pick browser or fallback location (+ toast)
    await loadAds();             // load ads and compute distances with that location
})();
