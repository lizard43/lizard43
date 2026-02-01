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
    imgPrev: document.getElementById("pagePrev"),
    img: document.getElementById("pageImage"),
    imgNext: document.getElementById("pageNext"),
    strip: document.getElementById("strip"),

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

function setImg(imgEl, page) {
    const p = clampPage(page);
    imgEl.dataset.page = String(p);
    imgEl.src = filenameForPage(p);
}

const SNAP_INSET = 80; // px

function snapToCurrent() {
    // prevent maybeFlipByScroll from firing due to this programmatic scroll
    snapLockUntil = Date.now() + 300;

    const curTop = el.img.offsetTop;
    const curH = el.img.offsetHeight;

    // Clamp inset so small images still work
    const inset = Math.min(SNAP_INSET, Math.max(0, curH - 1));

    el.stage.scrollTop = curTop + inset;
}

async function renderStrip(centerPage) {
    const p = clampPage(centerPage);
    state.page = p;

    const prev = (p <= START_PAGE) ? state.maxPage : (p - 1);
    const next = (p >= state.maxPage) ? START_PAGE : (p + 1);

    setImg(el.imgPrev, prev);
    setImg(el.img, p);
    setImg(el.imgNext, next);

    console.log(`PAGE ${state.page}: ${filenameForPage(state.page)}`);

    // Snap AFTER current image has layout (it might not be loaded yet)
    if (el.img.complete && el.img.naturalHeight > 0) {
        requestAnimationFrame(snapToCurrent);
    } else {
        el.img.addEventListener("load", () => requestAnimationFrame(snapToCurrent), { once: true });
        el.img.addEventListener("error", () => requestAnimationFrame(snapToCurrent), { once: true });
    }

}

function prevPage() {
    const p = (state.page <= START_PAGE) ? state.maxPage : (state.page - 1);
    renderStrip(p);
}

function nextPage() {
    const p = (state.page >= state.maxPage) ? START_PAGE : (state.page + 1);
    renderStrip(p);
}

let scrollLockUntil = 0;
let snapLockUntil = 0;

function maybeFlipByScroll() {
    const now = Date.now();
    if (now < scrollLockUntil) return;
    if (now < snapLockUntil) return;

    const curTop = el.img.offsetTop;
    const curBottom = curTop + el.img.offsetHeight;

    const viewTop = el.stage.scrollTop;
    const viewBottom = viewTop + el.stage.clientHeight;

    const threshold = 24;
    const SNAP_INSET = 80; // px inside the current page so we don't immediately flip

    if (viewBottom >= curBottom - threshold) {
        scrollLockUntil = now + 250;
        nextPage();
        return;
    }

    if (viewTop <= curTop + 2) {
        scrollLockUntil = now + 250;
        prevPage();
        return;
    }
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
    renderStrip(page);
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
            renderStrip(START_PAGE);
            break;
        case "End":
            renderStrip(state.maxPage);
            break;
    }
}

function wireUI() {
    el.btnPrev.addEventListener("click", prevPage);
    el.btnNext.addEventListener("click", nextPage);
    el.stage.addEventListener("scroll", maybeFlipByScroll, { passive: true });

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
    await renderStrip(START_PAGE);
}

init();
