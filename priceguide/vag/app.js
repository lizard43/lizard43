"use strict";

/*
  Expects vagal.json in the same folder (ARRAY format):
    [ { image, title, manufacturer, date, genre, page, variant:[...] }, ... ]

  Supports incoming URL param:
    ?s=search terms

  True lazy image loading:
    - We do NOT set <img src> initially.
    - We set data-src and use IntersectionObserver to populate src only when near viewport.
*/

const DATA_URL = "vagal_ups.json";

const el = {
  stage: document.getElementById("stage"),
  cards: document.getElementById("cards"),
  toast: document.getElementById("toast"),

  searchInput: document.getElementById("searchInput"),
  searchClear: document.getElementById("searchClear"),
  searchPrev: document.getElementById("searchPrev"),
  searchNext: document.getElementById("searchNext"),
  searchStatus: document.getElementById("searchStatus"),

  railKeys: document.getElementById("railKeys"),

  // modal
  imgModal: document.getElementById("imgModal"),
  imgModalClose: document.getElementById("imgModalClose"),
  imgModalImg: document.getElementById("imgModalImg"),
  imgModalCaption: document.getElementById("imgModalCaption"),
};

let games = [];
let generatedAt = null; // optional (only if you later wrap JSON)
let filtered = [];
let filteredBlobs = [];
let matches = [];
let matchPos = 0;
let lastQuery = "";

let keyBtns = {};
let keyToIndex = {};
let activeKey = null;

let imgObserver = null;

const LS_ADSTER_SNAPSHOT = "adster.priceguide.snapshot.v1";

let openedWithSearchParam = false; // true when page opened with ?s=...

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.remove("show"), 900);
}

function normalizeNoSpace(s) {
  return normalizeText(s).replace(/\s+/g, "");
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function firstKeyForTitle(title) {
  const n = normalizeText(title);
  if (!n) return "#";
  const c = n[0];
  if (c >= "a" && c <= "z") return c.toUpperCase();
  return "#";
}

function money(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return "$" + v.toLocaleString();
}

function variantRangeLine(v) {
  if (!v) return null;
  const lo = v.price_lower;
  const hi = v.price_higher;
  if (!Number.isFinite(Number(lo)) || !Number.isFinite(Number(hi))) return null;
  return `${money(lo)} – ${money(hi)}`;
}

function bestOverallRange(g) {
  const vs = Array.isArray(g.variant) ? g.variant : [];
  if (!vs.length) return null;

  let lo = null;
  let hi = null;

  for (const v of vs) {
    const vlo = Number(v?.price_lower);
    const vhi = Number(v?.price_higher);
    if (!Number.isFinite(vlo) || !Number.isFinite(vhi)) continue;
    lo = (lo == null) ? vlo : Math.min(lo, vlo);
    hi = (hi == null) ? vhi : Math.max(hi, vhi);
  }

  if (lo == null || hi == null) return null;
  return `${money(lo)} – ${money(hi)}`;
}

function buildBlob(g) {
  const vs = Array.isArray(g.variant) ? g.variant : [];
  const variantText = vs.map(v => [
    v?.type,
    v?.price_lower,
    v?.price_average,
    v?.price_higher
  ].join(" ")).join(" ");

  return normalizeText([
    g.title,
    g.manufacturer,
    g.date,
    g.genre,
    g.page,
    variantText,
  ].join(" "));
}

function setSearchNavEnabled(enabled) {
  el.searchPrev.disabled = !enabled;
  el.searchNext.disabled = !enabled;
}

function renderSearchStatus() {
  if (!lastQuery) {
    el.searchStatus.textContent = "";
    return;
  }
  if (matches.length === 0) {
    el.searchStatus.textContent = "No matches";
    return;
  }
  const g = filtered[matches[matchPos]];
  el.searchStatus.textContent = `${matchPos + 1}/${matches.length}: ${g.title}`;
}

function buildAZButtons() {
  el.railKeys.innerHTML = "";
  keyBtns = {};

  const keys = ["#"];
  for (let i = 65; i <= 90; i++) keys.push(String.fromCharCode(i));

  for (const k of keys) {
    const b = document.createElement("button");
    b.className = "rail-btn rail-key";
    b.textContent = k;
    b.dataset.key = k;
    b.title = `Jump to ${k}`;
    el.railKeys.appendChild(b);
    keyBtns[k] = b;
  }
}

function setActiveKey(k) {
  if (activeKey && keyBtns[activeKey]) keyBtns[activeKey].classList.remove("is-active");
  activeKey = k;
  if (activeKey && keyBtns[activeKey]) {
    keyBtns[activeKey].classList.add("is-active");
    const rail = el.railKeys;
    const btn = keyBtns[activeKey];
    const top = btn.offsetTop - rail.clientHeight / 2 + btn.clientHeight / 2;
    rail.scrollTo({ top, behavior: "auto" });
  }
}

function scrollToCardIndex(idx) {
  const card = el.cards.querySelector(`[data-idx="${idx}"]`);
  if (!card) {
    showToast("No entries");
    return;
  }
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function rebuildKeyIndex() {
  keyToIndex = {};
  for (let i = 0; i < filtered.length; i++) {
    const k = firstKeyForTitle(filtered[i].title);
    if (keyToIndex[k] === undefined) keyToIndex[k] = i;
  }
}

function onRailKeyClick(k) {
  if (keyToIndex[k] === undefined) {
    showToast(`No ${k} entries`);
    return;
  }
  setActiveKey(k);
  scrollToCardIndex(keyToIndex[k]);
}

function updateActiveKeyFromScroll() {
  const cards = el.cards.querySelectorAll(".card");
  if (!cards.length) return;

  const stageTop = el.stage.getBoundingClientRect().top;
  let bestIdx = null;

  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (r.bottom > stageTop + 8) {
      bestIdx = Number(c.dataset.idx);
      break;
    }
  }
  if (bestIdx == null || !Number.isFinite(bestIdx)) return;

  const k = firstKeyForTitle(filtered[bestIdx]?.title);
  if (k && k !== activeKey) setActiveKey(k);
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

function loadAdsterSnapshot() {
  try {
    const raw = localStorage.getItem(LS_ADSTER_SNAPSHOT);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return null;

    // Minimal sanity check
    const title = String(obj.title || "").trim();
    if (!title) return null;

    return obj;
  } catch (_) {
    return null;
  }
}

function adsterSnapshotCardHTML(snap) {
  if (!snap) return "";

  const title = String(snap.title || "—").trim();
  const priceText = String(snap.priceText || "").trim();
  const location = String(snap.location || "").trim();
  const desc = String(snap.description || "").trim();
  const adUrl = String(snap.adUrl || "").trim();
  const imageUrl = String(snap.imageUrl || "").trim();

  const source = String(snap.source || "").trim();     // e.g. "MP"
  const seller = String(snap.author || "").trim();     // e.g. "Mike Stine"

  const captionParts = [];
  if (title) captionParts.push(title);
  if (location) captionParts.push(location);
  const caption = captionParts.join(" · ");

  // Bottom line like Adster: "MP · Mike Stine"
  const whoParts = [];
  if (source) whoParts.push(escapeHtml(source));
  if (seller) whoParts.push(escapeHtml(seller));
  const whoLine = whoParts.length ? whoParts.join(" &nbsp;·&nbsp; ") : "";

  const priceLocParts = [];
  if (priceText) priceLocParts.push(`<span class="adsterPrice">${escapeHtml(priceText)}</span>`);
  if (location) priceLocParts.push(`<span class="adsterLoc">${escapeHtml(location)}</span>`);
  const priceLocLine = priceLocParts.length ? priceLocParts.join(" &nbsp;·&nbsp; ") : "";

  const imgInner = imageUrl
    ? `
      <img
        class="adsterThumb js-lazy"
        data-src="${escapeAttr(imageUrl)}"
        data-caption="${escapeAttr(caption)}"
        alt="${escapeAttr(title)}"
        decoding="async"
        referrerpolicy="no-referrer"
      >
    `
    : `<div class="adsterThumbFallback">No image</div>`;

  // Image and title both link to the original ad
  const imgBlock = adUrl
    ? `<a class="adsterMediaLink" href="${escapeAttr(adUrl)}" target="_blank" rel="noopener">${imgInner}</a>`
    : `<div class="adsterMediaLink">${imgInner}</div>`;

  const titleBlock = adUrl
    ? `<a class="adsterTitleLink" href="${escapeAttr(adUrl)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
    : `<div class="adsterTitleLink">${escapeHtml(title)}</div>`;

  const descBlock = desc
    ? `<div class="adsterDesc">${escapeHtml(desc)}</div>`
    : "";

  const priceLocBlock = priceLocLine
    ? `<div class="adsterMeta">${priceLocLine}</div>`
    : "";

  const whoBlock = whoLine
    ? `<div class="adsterWho">${whoLine}</div>`
    : "";

  return `
    <article class="card adsterCard" data-idx="-1">
      <div class="adsterCardInner">
        <div class="adsterMedia">
          ${imgBlock}
        </div>

        <div class="adsterBody">
          <div class="adsterTitleRow">
            ${titleBlock}
          </div>

          ${priceLocBlock}
          ${descBlock}
          ${whoBlock}
        </div>
      </div>
    </article>
  `;
}
/* ---------- Modal ---------- */

function openImageModal(src, caption) {
  if (!src) return;

  // prevent background scroll while modal open
  document.body.style.overflow = "hidden";

  el.imgModalImg.removeAttribute("src");
  el.imgModalImg.setAttribute("src", src);
  el.imgModalImg.alt = caption || "";

  el.imgModalCaption.textContent = caption || "";

  el.imgModal.classList.add("is-open");
  el.imgModal.setAttribute("aria-hidden", "false");
}

function closeImageModal() {
  el.imgModal.classList.remove("is-open");
  el.imgModal.setAttribute("aria-hidden", "true");

  el.imgModalImg.removeAttribute("src");
  el.imgModalImg.alt = "";
  el.imgModalCaption.textContent = "";

  document.body.style.overflow = "";
}

function isModalOpen() {
  return el.imgModal.classList.contains("is-open");
}

/* ---------- Cards ---------- */

function cardHTML(g, idx) {
  const title = g.title || "—";
  const mfg = g.manufacturer || null;
  const date = g.date || null;
  const genre = g.genre || null;
  let page = (g.page == null) ? null : String(g.page);

  const klovUrl =
    "https://www.arcade-museum.com/searchResults?q=" +
    encodeURIComponent(title) +
    "&boolean=AND";

  const line1 = `
  <div class="lineTitle">
    <a
      class="titleText"
      href="${klovUrl}"
      target="_blank"
      rel="noopener"
    >
      ${escapeHtml(title)}
    </a>
  </div>`;

  // Manufacturer – date
  const line2Parts = [];
  if (mfg) line2Parts.push(`<span class="mfgText">${escapeHtml(mfg)}</span>`);
  if (date) line2Parts.push(`<span class="metaMain">${escapeHtml(date)}</span>`);
  const line2 = line2Parts.length
    ? `<div class="lineMeta lineMetaMain">${line2Parts.join(" – ")}</div>`
    : "";

  // Genre (own line)
  const lineGenre = genre
    ? `<div class="lineMeta lineMetaGenre">${escapeHtml(genre)}</div>`
    : "";

  const line3 = "";

  // Keep page hidden as your current code effectively does
  const line4Parts = [];
  page = null;
  if (page) line4Parts.push(`<span>Page ${escapeHtml(page)}</span>`);
  const line4 = line4Parts.length ? `<div class="lineMeta">${line4Parts.join(" – ")}</div>` : "";

  // Variants: "Variant – low – high – average" (one row per variant)
  const vs = Array.isArray(g.variant) ? g.variant : [];
  let variantsBlock = "";
  if (vs.length) {
    const rows = [];
    for (const v of vs) {
      const type = v?.type ? String(v.type) : "Variant";

      const lo = money(Number(v?.price_lower));
      const hi = money(Number(v?.price_higher));
      const avg = money(Number(v?.price_average));

      const parts = [];
      parts.push(`<span>${escapeHtml(type)}</span>`);
      parts.push(`<span class="priceStrong">${escapeHtml(lo || "—")}</span>`);
      parts.push(`<span class="priceStrong">${escapeHtml(hi || "—")}</span>`);
      parts.push(`<span class="dim">${escapeHtml(avg || "— avg ")}</span>`);

      rows.push(`<div class="lineMeta">${parts.join(" – ")}</div>`);
    }
    variantsBlock = rows.join("");
  }

  const imgSrc = g.image ? `images/${g.image}` : "questionmark.png";

  // Store src + caption on the wrapper so clicks can open modal without extra lookups
  const caption = [title, mfg, date].filter(Boolean).join(" · ");

  const imgTag = `
    <img
      class="thumb js-lazy"
      data-src="${escapeAttr(imgSrc)}"
      data-caption="${escapeAttr(caption)}"
      alt="${escapeAttr(title)}"
      decoding="async"
    >
  `;

  return `
    <article class="card" data-idx="${idx}">
      <div class="thumbWrap" role="button" tabindex="0" aria-label="View image: ${escapeAttr(title)}">
        ${imgTag}
      </div>
      <div class="cardBody">
        ${line1}
        ${line2}
        ${lineGenre}
        ${variantsBlock}
      </div>
    </article>`;
}
function creditCardHTML() {
  let dateLine = "";
  if (generatedAt) {
    try {
      const d = new Date(generatedAt);
      const dateOnly = d.toISOString().split("T")[0];
      dateLine = `<div class="creditDate">Data generated: ${dateOnly}</div>`;
    } catch (_) { }
  }

  return `
    <article class="creditCard">
      <div class="creditInner">

        <div class="creditLogos">
          <a href="https://www.vintagearcadegal.com/" target="_blank" rel="noopener">
            <img
              src="images/vag.avif"
              alt="Vintage Arcade Gal"
              class="creditLogo"
              loading="lazy"
            />
          </a>

          <a href="https://www.arcade-museum.com/" target="_blank" rel="noopener">
            <img
              src="images/museum-of-the-game-logo-75.webp"
              alt="KLOV - Arcade Museum"
              class="creditLogo klovLogo"
              loading="lazy"
            />
          </a>
        </div>

        <div class="creditText">
          <div class="creditLine">
            Info and pricing is property of VAG Productions
          </div>
          <div class="creditLine">
            Images are property of KLOV
          </div>
          <div>
            This site is not affiliated with VAG or KLOV
          </div>
          ${dateLine}
        </div>

      </div>
    </article>
  `;
}
function setupImageObserver() {
  if (imgObserver) {
    try { imgObserver.disconnect(); } catch (_) { }
  }

  imgObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      const src = img.getAttribute("data-src");
      if (src && !img.getAttribute("src")) {
        img.setAttribute("src", src);
        img.setAttribute("loading", "lazy");
      }
      imgObserver.unobserve(img);
    }
  }, {
    root: el.stage,
    rootMargin: "600px 0px",
    threshold: 0.01
  });

  const imgs = el.cards.querySelectorAll("img.js-lazy[data-src]");
  imgs.forEach(img => imgObserver.observe(img));
}

function renderCards() {
  const cardsHtml = filtered.map((g, idx) => cardHTML(g, idx)).join("\n");

  let adsterHtml = "";
  if (openedWithSearchParam) {
    const snap = loadAdsterSnapshot();
    if (snap) adsterHtml = adsterSnapshotCardHTML(snap);
  }

  el.cards.innerHTML = creditCardHTML() + adsterHtml + cardsHtml;

  rebuildKeyIndex();
  updateActiveKeyFromScroll();
  setupImageObserver();
}

/* ---------- Search ---------- */

function runSearch(rawQuery) {
  lastQuery = rawQuery || "";

  const raw = String(rawQuery || "").trim();
  const qNorm = normalizeText(raw);
  const terms = qNorm ? qNorm.split(" ").filter(Boolean) : [];

  const wantsHyphenExact = /[-–—]/.test(raw);
  const qJoined = terms.join("");
  const qJoinedLen = qJoined.length;

  if (terms.length === 0) {
    filtered = games.slice();
    filteredBlobs = filtered.map(buildBlob);
    matches = [];
    matchPos = 0;
    setSearchNavEnabled(false);
    renderSearchStatus();
    renderCards();
    return;
  }

  const out = [];
  const blobs = [];

  for (const g of games) {
    const b = buildBlob(g);

    let hit = terms.every(t => b.includes(t));

    if (wantsHyphenExact && qJoinedLen >= 2) {
      const titleJoined = normalizeNoSpace(g.title || "");
      hit = titleJoined.includes(qJoined);
    }

    if (hit) {
      out.push(g);
      blobs.push(b);
    }
  }

  filtered = out;
  filteredBlobs = blobs;

  matches = [];
  for (let i = 0; i < filtered.length; i++) {
    const g = filtered[i];
    const b = filteredBlobs[i];

    let hit = terms.every(t => b.includes(t));

    if (wantsHyphenExact && qJoinedLen >= 2) {
      const titleJoined = normalizeNoSpace(g.title || "");
      hit = titleJoined.includes(qJoined);
    }

    if (hit) matches.push(i);
  }

  matchPos = 0;
  setSearchNavEnabled(matches.length > 0);
  renderSearchStatus();
  renderCards();

  if (matches.length > 0) jumpToMatch(0);
}

function renderSearchStatus() {
  if (!lastQuery) {
    el.searchStatus.textContent = "";
    return;
  }
  if (matches.length === 0) {
    el.searchStatus.textContent = "No matches";
    return;
  }
  const g = filtered[matches[matchPos]];
  el.searchStatus.textContent = `${matchPos + 1}/${matches.length}: ${g.title}`;
}

function jumpToMatch(pos) {
  if (matches.length === 0) return;
  const n = matches.length;
  matchPos = ((pos % n) + n) % n;

  const idx = matches[matchPos];
  const g = filtered[idx];
  renderSearchStatus();

  const k = firstKeyForTitle(g?.title);
  setActiveKey(k);
  scrollToCardIndex(idx);
  showToast(g?.title || "Match");
}

/* ---------- Wiring ---------- */

function wireUI() {
  buildAZButtons();

  el.railKeys.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-key]");
    if (!btn) return;
    onRailKeyClick(btn.dataset.key);
  });

  el.searchInput.addEventListener("input", (e) => runSearch(e.target.value));

  el.searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (matches.length > 0) jumpToMatch(matchPos + 1);
    }
  });

  el.searchClear.addEventListener("click", () => {
    el.searchInput.value = "";
    runSearch("");
    el.searchInput.focus();
  });

  el.searchPrev.addEventListener("click", () => jumpToMatch(matchPos - 1));
  el.searchNext.addEventListener("click", () => jumpToMatch(matchPos + 1));

  let raf = false;
  el.stage.addEventListener("scroll", () => {
    if (raf) return;
    raf = true;
    requestAnimationFrame(() => {
      raf = false;
      updateActiveKeyFromScroll();
    });
  }, { passive: true });

  // Thumbnail click (event delegation)
  el.cards.addEventListener("click", (e) => {
    const wrap = e.target.closest(".thumbWrap");
    if (!wrap) return;

    const img = wrap.querySelector("img.thumb");
    if (!img) return;

    const src = img.getAttribute("src") || img.getAttribute("data-src");
    const caption = img.getAttribute("data-caption") || img.getAttribute("alt") || "";
    openImageModal(src, caption);
  });

  // Thumbnail keyboard open
  el.cards.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const wrap = e.target.closest(".thumbWrap");
    if (!wrap) return;

    e.preventDefault();

    const img = wrap.querySelector("img.thumb");
    if (!img) return;

    const src = img.getAttribute("src") || img.getAttribute("data-src");
    const caption = img.getAttribute("data-caption") || img.getAttribute("alt") || "";
    openImageModal(src, caption);
  });

  // Modal close handlers
  el.imgModal.addEventListener("click", (e) => {
    if (e.target && e.target.matches("[data-modal-close]")) closeImageModal();
  });

  el.imgModalClose.addEventListener("click", () => closeImageModal());

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isModalOpen()) closeImageModal();
  });
}

async function loadData() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: HTTP ${res.status}`);
  const data = await res.json();

  // Accept either raw array or later a wrapped object (future-proof)
  let arr = null;
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && Array.isArray(data.games)) {
    arr = data.games;
    generatedAt = data.generated_at || null;
  } else {
    throw new Error("JSON must be an array: [ {...}, ... ] (or { games:[...]} )");
  }

  games = arr
    .filter(g => g && typeof g === "object")
    .map(g => ({
      image: g.image ?? null,
      title: g.title ?? "",
      manufacturer: g.manufacturer ?? null,
      date: g.date ?? null,
      genre: g.genre ?? null,
      page: g.page ?? null,
      variant: Array.isArray(g.variant) ? g.variant : [],
    }));

  games.sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base", numeric: true }));

  filtered = games.slice();
  filteredBlobs = filtered.map(buildBlob);
}

function applyIncomingSearchParam() {
  let pending = "";
  openedWithSearchParam = false;

  try {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("s");
    if (s && String(s).trim()) {
      pending = String(s).trim();
      openedWithSearchParam = true;
    }

    if (pending) {
      const clean = window.location.pathname + window.location.hash;
      history.replaceState(null, "", clean);
    }
  } catch (_) { }

  if (pending) {
    el.searchInput.value = pending;
    runSearch(pending);
    el.searchInput.focus();
  } else {
    runSearch("");
  }
}

async function init() {
  wireUI();

  try {
    await loadData();
    renderCards();
    setSearchNavEnabled(false);
    applyIncomingSearchParam();
  } catch (e) {
    console.error(e);
    el.cards.innerHTML = `<div class="lineMeta">Failed to load data. Put <strong>${DATA_URL}</strong> next to this HTML and run a local web server.</div>`;
    showToast("Data load failed");
  }
}

init();