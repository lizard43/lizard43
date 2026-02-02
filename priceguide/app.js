// ===== Config you’ll most likely tweak =====
const IMAGE_DIR = "";           // "" if images are alongside index.html
const FILE_PREFIX = "page_";           // page_001.jpg
const FILE_EXT = ".jpg";
const PAD = 3;                         // 001, 002, ...
const START_PAGE = 62;
const MAX_PAGE_GUESS = 419;            // can be overridden by bookmarks.json if it has totalPages
// =========================================

const IMG_W = 1484;
const IMG_H = 1920;
const ASPECT = IMG_H / IMG_W;

const POOL = 5;                 // 3 or 5
const POOL_HALF = Math.floor(POOL / 2);

let pageH = 1000;               // computed
let scale = 1;                  // keep your pinch scaling

const poolImgs = [];            // DOM elements
const poolPages = [];           // which page number each img currently shows

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

function atBottom() {
    return el.stage.scrollTop + el.stage.clientHeight >= el.stage.scrollHeight - 8;
}
function atTop() {
    return el.stage.scrollTop <= 8;
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
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartY = t.clientY;
    touchStartX = t.clientX;
    touchStartT = Date.now();
    touchStartScrollTop = el.stage.scrollTop;
    gestureActive = true;
}

function onTouchEnd(e) {
    if (Date.now() < pinchCooldownUntil) return;

    if (!gestureActive) return;
    gestureActive = false;

    const dt = Date.now() - touchStartT;
    if (dt > SWIPE_MAX_MS) return;

    // If user actually scrolled the stage, treat it as scrolling, not navigation
    const scrolled = Math.abs(el.stage.scrollTop - touchStartScrollTop);
    if (scrolled > 12) return;

    const t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
    if (!t) return;

    const dy = t.clientY - touchStartY;
    const dx = t.clientX - touchStartX;

    if (Math.abs(dx) > SWIPE_MAX_X) return;

    if (dy <= -SWIPE_MIN_PX) prevPage();      // swipe up
    else if (dy >= SWIPE_MIN_PX) nextPage(); // swipe down
}

function wireUI() {
    el.btnPrev.addEventListener("click", prevPage);
    el.btnNext.addEventListener("click", nextPage);

    el.stage.addEventListener("scroll", onScroll, { passive: true });

    el.stage.addEventListener("touchstart", (e) => {
        onTouchStart(e);
        onPinchStart(e);
    }, { passive: true });

    el.stage.addEventListener("touchmove", onPinchMove, { passive: false });

    el.stage.addEventListener("touchend", (e) => {
        onPinchEnd(e);
        if (pinchActive) return;
        onTouchEnd(e);
    }, { passive: true });

    el.stage.addEventListener("touchcancel", onPinchEnd, { passive: true });

    el.stage.addEventListener("wheel", onWheel, { passive: false });

    el.rail.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-key]");
        if (!btn) return;
        jumpByKey(btn.dataset.key);
    });

    document.addEventListener("keydown", onKeyDown);
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
    setDocumentHeight();
    updateVisible();

    for (const im of poolImgs) {
        im.loading = "eager";
        im.decoding = "async";
    }

    jumpToPage(START_PAGE);

    buildAZButtons();
    wireUI();
}

init();
