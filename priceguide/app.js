// ===== Config you’ll most likely tweak =====
const IMAGE_DIR = "";           // "" if images are alongside index.html
const FILE_PREFIX = "page_";           // page_001.jpg
const FILE_EXT = ".jpg";
const PAD = 3;                         // 001, 002, ...
const START_PAGE = 122;
const END_PAGE = 837;            // can be overridden by bookmarks.json if it has totalPages
// =========================================

const IMG_W = 550;
const IMG_H = 1600;
const ASPECT = IMG_H / IMG_W;

const POOL = 5;                 // 3 or 5
const POOL_HALF = Math.floor(POOL / 2);

let pageH = 1000;               // computed
let scale = 1;                  // keep your pinch scaling

const poolImgs = [];            // DOM elements
const poolPages = [];           // which page number each img currently shows

const BOOKMARKS = {
    totalPages: 837,
    byKey: {
        "#": 122,
        "A": 128,
        "B": 162,
        "C": 208,
        "D": 251,
        "E": 296,
        "F": 311,
        "G": 341,
        "H": 377,
        "I": 399,
        "J": 409,
        "K": 423,
        "L": 437,
        "M": 456,
        "N": 504,
        "O": 522,
        "P": 533,
        "Q": 572,
        "R": 578,
        "S": 614,
        "T": 735,
        "U": 782,
        "V": 788,
        "W": 806,
        "X": 826,
        "Y": 830,
        "Z": 831
    }
};

let state = {
    page: START_PAGE,
    maxPage: END_PAGE,
    keyMap: {},        // e.g. { "#": 122, "A": 128, ... }
    pageToKey: {},     // e.g. { "122": "#", "128": "A", ... }  <-- add
    keyBtns: {},       // e.g. { "#": <button>, "A": <button>, ... } <-- add
    lastPage: START_PAGE, // <-- add
    wheelLockUntil: 0
};

const el = {
    img0: document.getElementById("img0"),
    img1: document.getElementById("img1"),
    img2: document.getElementById("img2"),
    img3: document.getElementById("img3"),
    img4: document.getElementById("img4"),

    strip: document.getElementById("strip"),

    toast: document.getElementById("toast"),

    stage: document.getElementById("stage"),

    rail: document.getElementById("rail"),
    railKeys: document.getElementById("railKeys"),

    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),

    searchInput: document.getElementById("searchInput"),
    searchClear: document.getElementById("searchClear"),
    searchPrev: document.getElementById("searchPrev"),
    searchNext: document.getElementById("searchNext"),
    searchStatus: document.getElementById("searchStatus"),
};

poolImgs.length = 0;
poolImgs.push(el.img0, el.img1, el.img2, el.img3, el.img4);
poolPages.length = POOL;
poolPages.fill(null);

function logPage(reason) {
    console.log(`[${reason}] page=${state.page} scrollTop=${Math.round(el.stage.scrollTop)} scale=${scale.toFixed(2)}`);
}

function jumpToPage(page) {
    const p = clampPage(page);
    state.page = p;
    el.stage.scrollTop = ((p - START_PAGE) * pageH) * scale;
    updateVisible();
    logPage(`jumpTo(${p})`);
}

function computePageH() {
    const w = el.stage.clientWidth;
    pageH = w * ASPECT; // no *scale
}

function setDocumentHeight() {
    const total = (state.maxPage - START_PAGE + 1);
    el.strip.style.height = `${total * pageH}px`;
}

function pageFromScrollTop() {
    const viewMid = (el.stage.scrollTop + (el.stage.clientHeight / 2)) / scale;
    const idx = Math.floor(viewMid / pageH);
    return clampPage(START_PAGE + idx);
}

function placeImg(imgEl, page) {
    const p = clampPage(page);
    imgEl.dataset.page = String(p);
    imgEl.src = filenameForPage(p);

    const idx = (p - START_PAGE);
    imgEl.style.top = `${idx * pageH}px`; // unscaled, transform handles scaling
}

let rafPending = false;

function updateVisible() {
    state.page = pageFromScrollTop();

    const prev = state.lastPage;
    if (state.page !== prev) {
        // pulseDirection(state.page > prev ? "down" : "up");
        state.lastPage = state.page;
    }

    updateBookmarkHighlight(state.page);

    const base = state.page - POOL_HALF;
    for (let i = 0; i < POOL; i++) {
        const p = clampPage(base + i);
        if (poolPages[i] !== p) {
            poolPages[i] = p;
            placeImg(poolImgs[i], p);
        } else {
            // still need to update top if zoom/resize changes pageH
            const idx = (p - START_PAGE);
            poolImgs[i].style.top = `${idx * pageH}px`;
        }
    }
    logPage("update");
}

function onScroll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
        rafPending = false;
        updateVisible();
    });
}

function pad(n, width) {
    const s = String(n);
    return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

function filenameForPage(page) {
    return `${IMAGE_DIR}${FILE_PREFIX}${pad(page, PAD)}${FILE_EXT}`;
}

let activeKey = null;

function updateBookmarkHighlight(page) {
    // Find the "current" bookmark as the most recent bookmark page <= current page
    let bestKey = null;
    let bestPage = -Infinity;

    for (const [k, p] of Object.entries(state.keyMap)) {
        if (p <= page && p > bestPage) {
            bestPage = p;
            bestKey = k;
        }
    }

    // If we didn't find any (shouldn't happen given your START_PAGE matches '#'),
    // do nothing and keep whatever is currently active.
    if (!bestKey) return;

    // If it didn't change, do nothing (keeps highlight stable while scrolling)
    if (bestKey === activeKey) return;

    // Remove old highlight
    if (activeKey && state.keyBtns[activeKey]) {
        state.keyBtns[activeKey].classList.remove("is-active");
    }

    // Apply new highlight
    activeKey = bestKey;
    const btn = state.keyBtns[activeKey];
    if (btn) {
        btn.classList.add("is-active");

        const rail = el.railKeys;
        const top = btn.offsetTop - rail.clientHeight / 2 + btn.clientHeight / 2;
        rail.scrollTo({ top, behavior: "auto" });
    }
}

// function pulseDirection(dir /* "up" | "down" */) {
//     const btn = (dir === "up") ? el.btnPrev : el.btnNext;
//     btn.classList.add("is-dir");
//     clearTimeout(pulseDirection._t);
//     pulseDirection._t = setTimeout(() => btn.classList.remove("is-dir"), 140);
// }

function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.remove("show"), 900);
}

// ===================== Search (vagal.json) =====================

let games = [];              // raw objects from vagal.json
let gameBlobs = [];          // parallel array of searchable strings
let matches = [];            // indices into games[]
let matchPos = 0;
let lastQuery = "";

function normalizeText(s) {
    return String(s || "")
        .toLowerCase()
        .replace(/['’`]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function buildSearchBlob(g) {
    const types = Array.isArray(g?.variant) ? g.variant.map(v => v?.type).filter(Boolean).join(" ") : "";
    return normalizeText([g?.title, g?.manufacturer, g?.date, g?.genre, types].join(" "));
}

function setSearchNavEnabled(enabled) {
    if (el.searchPrev) el.searchPrev.disabled = !enabled;
    if (el.searchNext) el.searchNext.disabled = !enabled;
}

function renderSearchStatus() {
    if (!el.searchStatus) return;
    if (!lastQuery) {
        el.searchStatus.textContent = "";
        return;
    }
    if (matches.length === 0) {
        el.searchStatus.textContent = "0 matches";
        return;
    }
    const g = games[matches[matchPos]];
    const page = g?.page ?? "?";
    const title = g?.title ?? "";
    const mfg = g?.manufacturer ? ` — ${g.manufacturer}` : "";
    el.searchStatus.textContent = `${matchPos + 1}/${matches.length}: ${title}${mfg} (p${page})`;
}

function jumpToMatch(pos) {
    if (matches.length === 0) return;
    // Wrap within match list
    const n = matches.length;
    matchPos = ((pos % n) + n) % n;
    const g = games[matches[matchPos]];
    if (g && Number.isFinite(g.page)) {
        jumpToPage(Number(g.page));
        showToast(`${g.title} (p${g.page})`);
    }
    renderSearchStatus();
}

function runSearch(rawQuery) {
    lastQuery = rawQuery;
    const q = normalizeText(rawQuery);

    if (!q) {
        matches = [];
        matchPos = 0;
        setSearchNavEnabled(false);
        renderSearchStatus();
        return;
    }

    matches = [];
    for (let i = 0; i < gameBlobs.length; i++) {
        if (gameBlobs[i].includes(q)) matches.push(i);
    }
    matchPos = 0;

    // Enable nav even for 1 match (wrapping will keep it stable)
    setSearchNavEnabled(matches.length > 0);
    renderSearchStatus();

    if (matches.length > 0) {
        jumpToMatch(0);
    }
}

async function loadGameIndex() {
    try {
        const res = await fetch("vagal.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error("vagal.json is not an array");
        games = data;
        gameBlobs = games.map(buildSearchBlob);
        console.log(`[search] loaded ${games.length} entries from vagal.json`);
    } catch (err) {
        console.warn("[search] failed to load vagal.json", err);
        showToast("Search index failed to load");
    }
}

// ===============================================================

function clampPage(n) {
    if (!Number.isFinite(n)) return state.page;
    if (n < START_PAGE) return START_PAGE;
    if (n > state.maxPage) return state.maxPage;
    return n;
}

function buildAZButtons() {
    el.railKeys.innerHTML = "";

    // First: #
    const hashBtn = document.createElement("button");
    hashBtn.className = "rail-btn rail-key";
    hashBtn.textContent = "#";
    hashBtn.dataset.key = "#";
    hashBtn.title = "Bookmark #";
    el.railKeys.appendChild(hashBtn);

    // Then: A..Z
    for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        const b = document.createElement("button");
        b.className = "rail-btn rail-key";
        b.textContent = letter;
        b.dataset.key = letter;
        b.title = `Bookmark ${letter}`;
        el.railKeys.appendChild(b);
    }

    // Cache button refs for fast highlight updates
    state.keyBtns = {};
    el.railKeys.querySelectorAll("button[data-key]").forEach(btn => {
        state.keyBtns[btn.dataset.key] = btn;
    });
}

function loadBookmarks() {
    const data = BOOKMARKS;

    if (typeof data.totalPages === "number" && data.totalPages > 0) {
        state.maxPage = Math.floor(data.totalPages);
    }

    state.keyMap = {};
    if (data && typeof data.byKey === "object" && data.byKey) {
        for (const [k, v] of Object.entries(data.byKey)) {
            const page = Math.floor(Number(v));
            // Respect your "never below START_PAGE" rule:
            if (k && Number.isFinite(page) && page >= START_PAGE) {
                state.keyMap[k] = page;
            }
        }
    }

    state.pageToKey = {};
    for (const [k, p] of Object.entries(state.keyMap)) {
        state.pageToKey[String(p)] = k;
    }

    showToast("Bookmarks loaded");
}

function jumpByKey(k) {
    const page = state.keyMap?.[k];
    if (page) jumpToPage(page);
    if (!page) {
        showToast(`No bookmark for ${k}`);
        return;
    }
}

function prevPage() {
    const cur = pageFromScrollTop();
    jumpToPage(cur <= START_PAGE ? state.maxPage : cur - 1);
    logPage("prev");
}

function nextPage() {
    const cur = pageFromScrollTop();
    jumpToPage(cur >= state.maxPage ? START_PAGE : cur + 1);
    logPage("next");
}

function applyScale(newScale) {
    // Preserve position within current page in *unscaled* units
    const oldScale = scale;
    const unscaledScroll = el.stage.scrollTop / oldScale;

    const cur = pageFromScrollTop();
    const pageIndex = cur - START_PAGE;

    const oldOffsetUnscaled = unscaledScroll - pageIndex * pageH;
    const ratio = pageH > 0 ? (oldOffsetUnscaled / pageH) : 0;

    // Apply new scale + visual transform
    scale = Math.max(1, Math.min(4, newScale));
    el.strip.style.transform = `scale(${scale})`;

    // pageH is based on width/aspect only (as you wrote)
    computePageH();
    setDocumentHeight();

    // Restore scroll position at same within-page ratio
    const newUnscaledScroll = pageIndex * pageH + ratio * pageH;
    el.stage.scrollTop = newUnscaledScroll * scale;

    updateVisible();
}

const EDGE_EPS = 40; // 40–80px tends to be safe on mobile

function atBottom() {
    return el.stage.scrollTop + el.stage.clientHeight >= el.stage.scrollHeight - EDGE_EPS;
}
function atTop() {
    return el.stage.scrollTop <= EDGE_EPS;
}

function onWheel(e) {
    const now = Date.now();
    if (now < state.wheelLockUntil) {
        e.preventDefault();
        return;
    }

    // Only wrap if user is trying to scroll past the edge
    if (e.deltaY < 0 && atTop()) {
        e.preventDefault();
        state.wheelLockUntil = now + 200;
        jumpToPage(state.maxPage);
        // Put them at the bottom of the last page
        el.stage.scrollTop = (((state.maxPage - START_PAGE + 1) * pageH) * scale) - el.stage.clientHeight - 2;

        return;
    }

    if (e.deltaY > 0 && atBottom()) {
        e.preventDefault();
        state.wheelLockUntil = now + 200;
        jumpToPage(START_PAGE);
        el.stage.scrollTop = 0;
        return;
    }
}

function onKeyDown(e) {

    switch (e.key) {
        case "ArrowLeft":
        case "PageUp":
            prevPage();
            break;
        case "ArrowRight":
        case "PageDown":
            nextPage();
            break;
        case "Home":
            jumpToPage(START_PAGE)
            break;
        case "End":
            jumpToPage(state.maxPage)
            break;
    }
}

let touchStartScrollTop = 0;
let touchStartY = 0;
let touchStartX = 0;
let touchStartT = 0;
let gestureActive = false;
let touchStartAtTop = false;
let touchStartAtBottom = false;

const SWIPE_MIN_PX = 70;     // how far to swipe
const SWIPE_MAX_MS = 600;    // time window
const SWIPE_MAX_X = 80;      // avoid diagonal/side swipes

let pinchActive = false;
let pinchStartDist = 0;
let pinchStartScale = 1;
let pinchCooldownUntil = 0;

function pinchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
}

function onPinchStart(e) {
    if (e.touches.length !== 2) return;
    pinchActive = true;
    gestureActive = false; // cancel swipe tracking if pinch begins mid-gesture
    pinchStartDist = pinchDist(e.touches[0], e.touches[1]);
    pinchStartScale = scale;
}

function onPinchMove(e) {
    if (!pinchActive || e.touches.length !== 2) return;
    e.preventDefault(); // prevent browser gesture
    const d = pinchDist(e.touches[0], e.touches[1]);
    const ratio = d / pinchStartDist;
    applyScale(pinchStartScale * ratio);
}

function onPinchEnd(e) {
    if (e.touches.length < 2) {
        pinchActive = false;
        pinchCooldownUntil = Date.now() + 250; // 250ms is plenty
    }
}

function onTouchStart(e) {
    touchStartAtTop = atTop();
    touchStartAtBottom = atBottom();

    console.log("touchStart", {
        scrollTop: Math.round(el.stage.scrollTop),
        atTop: atTop(),
        atBottom: atBottom()
    });

    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartY = t.clientY;
    touchStartX = t.clientX;
    touchStartT = Date.now();
    touchStartScrollTop = el.stage.scrollTop;
    gestureActive = true;
}

function onTouchEnd(e) {
    // if (Date.now() < pinchCooldownUntil) return;

    if (!gestureActive) return;
    gestureActive = false;

    const dt = Date.now() - touchStartT;
    if (dt > SWIPE_MAX_MS) return;

    const scrolled = Math.abs(el.stage.scrollTop - touchStartScrollTop);

    // If we scrolled a lot AND we did NOT start at an edge, treat as scroll
    if (scrolled > 12 && !touchStartAtTop && !touchStartAtBottom) return;

    const t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
    if (!t) return;

    const dy = t.clientY - touchStartY;
    const dx = t.clientX - touchStartX;

    if (Math.abs(dx) > SWIPE_MAX_X) return;

    // Edge-wrap behavior for swipe (do NOT rely on pageFromScrollTop midpoint here)
    // if (dy <= -SWIPE_MIN_PX) { // swipe up = go "back"
    //     if (touchStartAtTop) jumpToPage(state.maxPage);
    //     else prevPage();
    // }
    // else if (dy >= SWIPE_MIN_PX) { // swipe down = go "forward"
    //     if (touchStartAtBottom) jumpToPage(START_PAGE);
    //     else nextPage();
    // }

    if (dy <= -SWIPE_MIN_PX) prevPage();
    else if (dy >= SWIPE_MIN_PX) nextPage();

}

function wireUI() {
    el.btnPrev.addEventListener("click", prevPage);
    el.btnNext.addEventListener("click", nextPage);

    el.stage.addEventListener("scroll", onScroll, { passive: true });

    // el.stage.addEventListener("touchstart", (e) => {
    //     onTouchStart(e);
    //     onPinchStart(e);
    // }, { passive: true });

    // el.stage.addEventListener("touchmove", onPinchMove, { passive: false });

    // el.stage.addEventListener("touchend", (e) => {
    //     onPinchEnd(e);
    //     if (pinchActive) return;
    //     onTouchEnd(e);
    // }, { passive: true });

    // el.stage.addEventListener("touchcancel", onPinchEnd, { passive: true });

    el.stage.addEventListener("touchstart", onTouchStart, { passive: true });
    el.stage.addEventListener("touchend", onTouchEnd, { passive: true });

    el.stage.addEventListener("wheel", onWheel, { passive: false });

    el.rail.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-key]");
        if (!btn) return;
        jumpByKey(btn.dataset.key);
    });

    document.addEventListener("keydown", onKeyDown);

    // Search UI (vagal.json)
    if (el.searchInput) {
        el.searchInput.addEventListener("input", (e) => {
            runSearch(e.target.value);
        });

        el.searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                // Enter cycles forward through matches (handy on mobile)
                if (matches.length > 0) {
                    const next = (matchPos + 1) % matches.length;
                    jumpToMatch(next);
                }
            }
        });
    }

    if (el.searchClear) {
        el.searchClear.addEventListener("click", () => {
            if (el.searchInput) el.searchInput.value = "";
            runSearch("");
            if (el.searchInput) el.searchInput.focus();
        });
    }

    if (el.searchPrev) {
        el.searchPrev.addEventListener("click", () => {
            if (matches.length === 0) return;
            // wrap
            jumpToMatch(matchPos - 1);
        });
    }

    if (el.searchNext) {
        el.searchNext.addEventListener("click", () => {
            if (matches.length === 0) return;
            // wrap
            jumpToMatch(matchPos + 1);
        });
    }
}

window.addEventListener("resize", () => {
    computePageH();
    // preserve current page anchor in scroll space:
    const curIndex = state.page - START_PAGE;
    el.stage.scrollTop = curIndex * pageH;
    updateVisible();
});

async function init() {
    computePageH();
    loadBookmarks();

    buildAZButtons();          // <-- move up so keyBtns exist
    setDocumentHeight();

    updateVisible();           // now highlight can apply
    jumpToPage(START_PAGE);    // this calls updateVisible again, which is fine

    for (const im of poolImgs) {
        im.loading = "eager";
        im.decoding = "async";
    }

    wireUI();

    // Load search index last (async fetch). UI still works without it.
    await loadGameIndex();
    setSearchNavEnabled(false);
}

init();
