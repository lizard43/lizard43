// ===== Config you’ll most likely tweak =====
const IMAGE_DIR = "";           // "" if images are alongside index.html
const FILE_PREFIX = "page_";           // page_001.jpg
const FILE_EXT = ".jpg";
const PAD = 3;                         // 001, 002, ...
const START_PAGE = 62;
const MAX_PAGE_GUESS = 419;            // can be overridden by bookmarks.json if it has totalPages
// =========================================

const BOOKMARKS = {
    totalPages: 419,
    byKey: {
        "#": 62,
        "A": 65,
        "B": 82,
        "C": 105,
        "D": 126,
        "E": 143,
        "F": 156,
        "G": 171,
        "H": 189,
        "I": 200,
        "J": 205,
        "K": 212,
        "L": 219,
        "M": 229,
        "N": 252,
        "O": 262,
        "P": 267,
        "Q": 287,
        "R": 290,
        "S": 308,
        "T": 368,
        "U": 392,
        "V": 395,
        "W": 404,
        "X": 414,
        "Y": 416,
        "Z": 416
    }
};

let state = {
    page: START_PAGE,
    maxPage: MAX_PAGE_GUESS,
    keyMap: {},   // e.g. { "#": 62, "A": 65, ... }
    wheelLockUntil: 0
};

const el = {
    img: document.getElementById("pageImage"),
    toast: document.getElementById("toast"),
    stage: document.getElementById("stage"),

    rail: document.getElementById("rail"),
    railKeys: document.getElementById("railKeys"),

    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
};

function pad(n, width) {
    const s = String(n);
    return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

function filenameForPage(page) {
    return `${IMAGE_DIR}${FILE_PREFIX}${pad(page, PAD)}${FILE_EXT}`;
}

function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.remove("show"), 900);
}

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
}

function preloadPage(page) {
    page = clampPage(page);
    const src = filenameForPage(page);
    const img = new Image();
    img.src = src;
}

async function loadPage(page, { scrollTo } = {}) {
    page = clampPage(page);
    state.page = page;

    const src = filenameForPage(page);

    // Load with error handling so we can try to determine max page if unknown
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            el.img.src = src;
            console.log(`PAGE ${state.page}: ${src}`);
            // Let layout happen, then position scroll
            requestAnimationFrame(() => {
                if (scrollTo === "top") el.stage.scrollTop = 0;
                if (scrollTo === "bottom") el.stage.scrollTop = el.stage.scrollHeight - el.stage.clientHeight;

            });
            preloadPage(state.page + 1);
            preloadPage(state.page - 1);
            resolve(true);
        };
        img.onerror = () => {

            // If we hit a missing file while moving forward, assume we found the end.
            // Step back one page if this page doesn't exist.
            if (page > 1) {
                state.maxPage = Math.min(state.maxPage, page - 1);
                showToast(`End at page ${state.maxPage}`);
                // If current page missing, go to last known valid
                if (state.page > state.maxPage) {
                    state.page = state.maxPage;
                }
            } else {
                showToast(`Can't load ${src}`);
            }
            resolve(false);
        };
        img.src = src;
    });
}

function prevPage() {
    const p = (state.page <= START_PAGE) ? state.maxPage : (state.page - 1);
    loadPage(p, { scrollTo: "bottom" });
}

function nextPage() {
    const p = (state.page >= state.maxPage) ? START_PAGE : (state.page + 1);
    loadPage(p, { scrollTo: "top" });
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

    showToast("Bookmarks loaded");
}

function jumpByKey(k) {
    const page = state.keyMap?.[k];
    if (!page) {
        showToast(`No bookmark for ${k}`);
        return;
    }
    loadPage(page, { scrollTo: "top" });
}

function atTop() {
    return el.stage.scrollTop <= 0;
}

function atBottom() {
    // allow a small epsilon
    return el.stage.scrollTop + el.stage.clientHeight >= el.stage.scrollHeight - 1;
}

function onWheel(e) {
    const now = Date.now();
    if (now < state.wheelLockUntil) return;

    const dy = e.deltaY;

    // If user is scrolling down but we're already at bottom -> next page
    if (dy > 0 && atBottom()) {
        e.preventDefault();
        nextPage();
        state.wheelLockUntil = now + 220;
        return;
    }

    // If user is scrolling up but we're already at top -> previous page
    if (dy < 0 && atTop()) {
        e.preventDefault();
        prevPage();
        state.wheelLockUntil = now + 220;
        return;
    }

    // Otherwise: let the browser perform normal scrolling inside the stage
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
            loadPage(START_PAGE, { scrollTo: "top" });
            break;
        case "End":
            loadPage(state.maxPage);
            break;
    }
}

function wireUI() {
    el.btnPrev.addEventListener("click", prevPage);
    el.btnNext.addEventListener("click", nextPage);

    // handle clicks on # and A..Z
    el.rail.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-key]");
        if (!btn) return;
        jumpByKey(btn.dataset.key);
    });

    el.stage.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKeyDown);
}

async function init() {
    buildAZButtons();
    wireUI();
    loadBookmarks();
    await loadPage(START_PAGE, { scrollTo: "top" });
}

init();
