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

function getCurrentTop() {
    return el.img.offsetTop; // top of the middle image
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

function snapToCurrent() {
    el.stage.scrollTop = el.img.offsetTop;
}

function rotateForwardKeepView() {
    // We are moving from current -> next
    // After rotation, the old "next" becomes the new current.
    // To keep the viewport showing the same visual point, subtract the height of the old current page.
    const h = el.img.offsetHeight || 0;

    const newPrevPage = state.page; // old current
    const newCurrentPage = (state.page >= state.maxPage) ? START_PAGE : (state.page + 1);
    const newNextPage = (newCurrentPage >= state.maxPage) ? START_PAGE : (newCurrentPage + 1);

    state.page = newCurrentPage;

    // Rotate DOM sources
    setImg(el.imgPrev, newPrevPage);
    setImg(el.img, newCurrentPage);
    setImg(el.imgNext, newNextPage);

    // Keep view continuous
    el.stage.scrollTop -= h;

    console.log(`PAGE ${state.page}: ${filenameForPage(state.page)}`);

    preloadPage(newPrevPage);
    preloadPage(newNextPage);
}

function rotateBackwardKeepView() {
    // We are moving from current -> prev
    // After rotation, the old "prev" becomes the new current.
    // To keep the viewport showing the same visual point, add the height of the new current page (old prev).
    const h = el.imgPrev.offsetHeight || 0;

    const newNextPage = state.page; // old current
    const newCurrentPage = (state.page <= START_PAGE) ? state.maxPage : (state.page - 1);
    const newPrevPage = (newCurrentPage <= START_PAGE) ? state.maxPage : (newCurrentPage - 1);

    state.page = newCurrentPage;

    setImg(el.imgPrev, newPrevPage);
    setImg(el.img, newCurrentPage);
    setImg(el.imgNext, newNextPage);

    el.stage.scrollTop += h;

    console.log(`PAGE ${state.page}: ${filenameForPage(state.page)}`);

    preloadPage(newPrevPage);
    preloadPage(newNextPage);
}

function currentTop() { return el.img.offsetTop; }
function currentBottom() { return el.img.offsetTop + el.img.offsetHeight; }

let rotateLock = 0;

function maybeRotateByPosition() {
    const now = Date.now();
    if (now < rotateLock) return;

    const viewTop = el.stage.scrollTop;
    const viewBottom = viewTop + el.stage.clientHeight;

    // If you've scrolled into the next page far enough that the current page is mostly off-screen, rotate forward.
    if (viewTop >= currentBottom() - 40) {
        rotateLock = now + 120;
        rotateForwardKeepView();
        return;
    }

    // If you've scrolled above the current page into prev, rotate backward.
    if (viewBottom <= currentTop() + 40) {
        rotateLock = now + 120;
        rotateBackwardKeepView();
        return;
    }
}

async function renderStrip(centerPage, { snap = false } = {}) {

    const p = clampPage(centerPage);
    state.page = p;

    const prev = (p <= START_PAGE) ? state.maxPage : (p - 1);
    const next = (p >= state.maxPage) ? START_PAGE : (p + 1);

    setImg(el.imgPrev, prev);
    setImg(el.img, p);
    setImg(el.imgNext, next);

    console.log(`PAGE ${state.page}: ${filenameForPage(state.page)}`);

    // Snap AFTER current image has layout (it might not be loaded yet)
    if (snap) {
        if (el.img.complete && el.img.naturalHeight > 0) {
            requestAnimationFrame(snapToCurrent);
        } else {
            el.img.addEventListener("load", () => requestAnimationFrame(snapToCurrent), { once: true });
            el.img.addEventListener("error", () => requestAnimationFrame(snapToCurrent), { once: true });
        }
    }

    preloadPage(prev);
    preloadPage(next);
}

function nextFrame() {
    return new Promise(r => requestAnimationFrame(r));
}

async function prevPage() {
    // Preserve where we are in the strip before changing anything
    const oldScroll = el.stage.scrollTop;
    const oldCurTop = el.img.offsetTop;

    const p = (state.page <= START_PAGE) ? state.maxPage : (state.page - 1);
    await renderStrip(p, { snap: false });

    // Wait a frame so offsets reflect the new images
    await nextFrame();

    const newCurTop = el.img.offsetTop;

    // Adjust scroll so the viewport stays on the same visual content
    el.stage.scrollTop = oldScroll + (newCurTop - oldCurTop);
}

async function nextPage() {
    const oldScroll = el.stage.scrollTop;
    const oldCurTop = el.img.offsetTop;

    const p = (state.page >= state.maxPage) ? START_PAGE : (state.page + 1);
    await renderStrip(p, { snap: false });

    await nextFrame();

    const newCurTop = el.img.offsetTop;
    el.stage.scrollTop = oldScroll + (newCurTop - oldCurTop);
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
    renderStrip(page, { snap: true }); // ok for jumps
}

function atTop() {
    return el.stage.scrollTop <= 0;
}

function atBottom() {
    // allow a small epsilon
    return el.stage.scrollTop + el.stage.clientHeight >= el.stage.scrollHeight - 1;
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
let scale = 1;

function pinchDist(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
}

function applyScale(newScale) {
    scale = Math.max(1, Math.min(4, newScale)); // 1x..4x
    el.strip.style.transform = `scale(${scale})`;
}

function onPinchStart(e) {
    if (e.touches.length !== 2) return;
    pinchActive = true;
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
    if (e.touches.length < 2) pinchActive = false;
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

    if (dy <= -SWIPE_MIN_PX) nextPage();
    else if (dy >= SWIPE_MIN_PX) prevPage();
}

function wireUI() {
    el.btnNext.addEventListener("click", () => {
        // Jump to just past the bottom of current to force a forward rotate
        el.stage.scrollTop = currentBottom() + 10;
        maybeRotateByPosition();
    });

    el.btnPrev.addEventListener("click", () => {
        // Jump to just before the top of current to force a backward rotate
        el.stage.scrollTop = currentTop() - 10;
        maybeRotateByPosition();
    });

    el.stage.addEventListener("touchstart", onPinchStart, { passive: true });
    el.stage.addEventListener("touchmove", onPinchMove, { passive: false });
    el.stage.addEventListener("touchend", onPinchEnd, { passive: true });
    el.stage.addEventListener("touchcancel", onPinchEnd, { passive: true });
    el.stage.addEventListener("scroll", maybeRotateByPosition, { passive: true });

    // handle clicks on # and A..Z
    el.rail.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-key]");
        if (!btn) return;
        jumpByKey(btn.dataset.key);
    });

    document.addEventListener("keydown", onKeyDown);
}

async function init() {
    buildAZButtons();
    wireUI();
    loadBookmarks();
    await renderStrip(START_PAGE, { snap: true });

}

init();
