// ===== Config you’ll most likely tweak =====
const IMAGE_DIR = "";           // "" if images are alongside index.html
const FILE_PREFIX = "page_";           // page_001.jpg
const FILE_EXT = ".jpg";
const PAD = 3;                         // 001, 002, ...
const START_PAGE = 62;
const MAX_PAGE_GUESS = 419;            // can be overridden by bookmarks.json if it has totalPages
const BOOKMARKS_FILE = "bookmarks.json";
// =========================================

let state = {
    page: START_PAGE,
    maxPage: MAX_PAGE_GUESS,
    bookmarks: [],
    wheelLockUntil: 0
};

const el = {
    img: document.getElementById("pageImage"),
    status: document.getElementById("statusText"),
    toast: document.getElementById("toast"),
    pageInput: document.getElementById("pageInput"),
    btnGo: document.getElementById("btnGo"),
    btnPrev: document.getElementById("btnPrev"),
    btnNext: document.getElementById("btnNext"),
    bmSelect: document.getElementById("bookmarkSelect"),
    bmGo: document.getElementById("btnBookmarkGo"),
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
    if (n < 1) return 1;
    if (n > state.maxPage) return state.maxPage;
    return n;
}

function setStatus(text) {
    el.status.textContent = text;
}

async function loadPage(page) {
    page = clampPage(page);
    state.page = page;
    el.pageInput.value = page;

    const src = filenameForPage(page);
    setStatus(`Loading ${src} …`);

    // Load with error handling so we can try to determine max page if unknown
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            el.img.src = src;
            setStatus(`Page ${state.page} • ${src}`);
            resolve(true);
        };
        img.onerror = () => {
            setStatus(`Missing: ${src}`);

            // If we hit a missing file while moving forward, assume we found the end.
            // Step back one page if this page doesn't exist.
            if (page > 1) {
                state.maxPage = Math.min(state.maxPage, page - 1);
                showToast(`End at page ${state.maxPage}`);
                // If current page missing, go to last known valid
                if (state.page > state.maxPage) {
                    state.page = state.maxPage;
                    el.pageInput.value = state.page;
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
    loadPage(p);
}

function nextPage() {
    const p = (state.page >= state.maxPage) ? START_PAGE : (state.page + 1);
    loadPage(p);
}

function goToPage(n) {
    n = Math.floor(Number(n));
    if (!Number.isFinite(n)) return;
    loadPage(n);
}

function populateBookmarks(bookmarks) {
    el.bmSelect.innerHTML = `<option value="">(none)</option>`;
    for (const bm of bookmarks) {
        const opt = document.createElement("option");
        opt.value = String(bm.page);
        opt.textContent = `${bm.label} (p.${bm.page})`;
        el.bmSelect.appendChild(opt);
    }
}

async function loadBookmarks() {
    try {
        const res = await fetch(BOOKMARKS_FILE, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Expected shape:
        // { "totalPages": 123, "bookmarks":[{"label":"...", "page": 12}, ...] }
        if (typeof data.totalPages === "number" && data.totalPages > 0) {
            state.maxPage = Math.floor(data.totalPages);
        }
        if (Array.isArray(data.bookmarks)) {
            state.bookmarks = data.bookmarks
                .filter(b => b && typeof b.page === "number" && typeof b.label === "string")
                .map(b => ({ label: b.label, page: Math.floor(b.page) }))
                .filter(b => b.page >= 1);
            populateBookmarks(state.bookmarks);
        }

        showToast("Bookmarks loaded");
    } catch (e) {
        // Bookmarks are optional; viewer still works.
        setStatus(`No bookmarks (${BOOKMARKS_FILE} not loaded)`);
    }
}

function onWheel(e) {
    // Prevent browser scroll/zoom gestures from fighting us
    e.preventDefault();

    const now = Date.now();
    if (now < state.wheelLockUntil) return;

    // Trackpad produces small deltas; wheel produces larger.
    // Use deltaY sign and a threshold.
    const dy = e.deltaY;

    const threshold = 18;
    if (Math.abs(dy) < threshold) return;

    if (dy > 0) nextPage();
    else prevPage();

    // Simple debounce/lock to avoid blasting through pages
    state.wheelLockUntil = now + 220;
}

function onKeyDown(e) {
    if (["INPUT", "SELECT"].includes(document.activeElement?.tagName)) {
        // Let user type in the page field naturally
        if (e.key === "Enter" && document.activeElement === el.pageInput) {
            goToPage(el.pageInput.value);
        }
        return;
    }

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
            loadPage(1);
            break;
        case "End":
            loadPage(state.maxPage);
            break;
    }
}

function wireUI() {
    el.btnPrev.addEventListener("click", prevPage);
    el.btnNext.addEventListener("click", nextPage);

    el.btnGo.addEventListener("click", () => goToPage(el.pageInput.value));
    el.pageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") goToPage(el.pageInput.value);
    });

    el.bmGo.addEventListener("click", () => {
        const v = el.bmSelect.value;
        if (!v) return;
        goToPage(v);
    });

    // Wheel navigation: attach to the whole document (and prevent default)
    // Note: needs { passive: false } or preventDefault won't work.
    document.addEventListener("wheel", onWheel, { passive: false });

    document.addEventListener("keydown", onKeyDown);
}

async function init() {
    wireUI();
    await loadBookmarks();
    await loadPage(START_PAGE);
}

init();
