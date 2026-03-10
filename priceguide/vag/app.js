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

const DATA_URL = "vagal_rated.json";

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

  switchGuide: document.getElementById("switchGuide"),

  // modal
  imgModal: document.getElementById("imgModal"),
  imgModalClose: document.getElementById("imgModalClose"),
  imgModalPrev: document.getElementById("imgModalPrev"),
  imgModalNext: document.getElementById("imgModalNext"),
  imgModalGallery: document.getElementById("imgModalGallery"),
  imgModalImgPrev: document.getElementById("imgModalImgPrev"),
  imgModalImg: document.getElementById("imgModalImg"),
  imgModalImgNext: document.getElementById("imgModalImgNext"),
  imgModalCaption: document.getElementById("imgModalCaption"),
};

let games = [];
let generatedAt = null; // optional (only if you later wrap JSON)
let filtered = [];
let filteredBlobs = [];
let matches = [];
let matchPos = 0;
let lastQuery = "";
let hiddenKeys = new Set();
let creditCardGone = false; // once auto-hidden/removed, don't re-render it again

let keyBtns = {};
let keyToIndex = {};
let activeKey = null;

let imgObserver = null;

let filteredJoinedBlobs = [];

const LS_ADSTER_SNAPSHOT = "adster.priceguide.snapshot.v1";

let openedWithSearchParam = false; // true when page opened with ?s=...

let modalState = {
  isPageStrip: false,
  pageNum: null,
  captionBase: "",
};

// add near your other top-level state vars
let adsterCardDismissed = false;

function dismissAdsterCard() {
  adsterCardDismissed = true;

  try {
    localStorage.removeItem(LS_ADSTER_SNAPSHOT);
  } catch (_) { }

  const card = el.cards.querySelector(".adsterCard");
  if (card) {
    try { card.remove(); } catch (_) {
      try { card.parentNode && card.parentNode.removeChild(card); } catch (_) { }
    }
  }

  showToast("Ad cleared");
}

function machineKey(m) {
  // prefer stable unique id if present
  const pid = String(m?.pinsideID || "").trim();
  if (pid) return `pid:${pid}`;

  // fallback (good enough for session-only hiding)
  const name = String(m?.name || "").trim();
  const mfg = String(m?.manufacturer || "").trim();
  const date = String(m?.date || "").trim();
  return `k:${name}|${mfg}|${date}`;
}

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

function titleSortKey(title) {
  return String(title || "")
    .trim()
    .replace(/^[^a-z0-9]+/i, "");
}

function firstKeyForTitle(title) {
  const n = normalizeText(titleSortKey(title));
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

function hasNonZeroNumber(v) {
  return Number.isFinite(Number(v)) && Number(v) !== 0;
}

function formatRatingValue(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;

  // Keep one decimal if needed, but drop trailing .0
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

function ratingsSummaryHTML(ratings) {
  if (!ratings || typeof ratings !== "object") return "";

  const parts = [];

  if (hasNonZeroNumber(ratings.user)) {
    parts.push(`User: ${escapeHtml(formatRatingValue(ratings.user))}`);
  }
  if (hasNonZeroNumber(ratings.fun)) {
    parts.push(`Fun: ${escapeHtml(formatRatingValue(ratings.fun))}`);
  }
  if (hasNonZeroNumber(ratings.collector)) {
    parts.push(`Collect: ${escapeHtml(formatRatingValue(ratings.collector))}`);
  }

  return parts.join("&nbsp;&nbsp;");
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

function parsePriceNumberFromText(priceText) {
  // Accept strings like "$1,500", "1500", "$ 1,500.00"
  const s = String(priceText || "").trim();
  if (!s) return null;

  const cleaned = s.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function overallLowHighFromGame(g) {
  const vs = Array.isArray(g?.variant) ? g.variant : [];
  if (!vs.length) return { lo: null, hi: null };

  let lo = null;
  let hi = null;

  for (const v of vs) {
    const vlo = Number(v?.price_lower);
    const vhi = Number(v?.price_higher);
    if (Number.isFinite(vlo)) lo = (lo == null) ? vlo : Math.min(lo, vlo);
    if (Number.isFinite(vhi)) hi = (hi == null) ? vhi : Math.max(hi, vhi);
  }

  return { lo, hi };
}

function adsterPriceClassForCurrentResults(snap) {
  // Only apply color logic when exactly one priceguide entry matched
  if (!snap) return "";
  if (filtered.length !== 1) return "";

  // Incoming ad price
  const incoming =
    Number.isFinite(Number(snap.priceNumber)) ? Number(snap.priceNumber) :
      parsePriceNumberFromText(snap.priceText);

  if (!Number.isFinite(incoming)) return "";

  const { lo, hi } = overallLowHighFromGame(filtered[0]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return "";

  // Correct rule:
  // - green if below overall low
  // - red if above overall high
  // - otherwise neutral
  if (incoming < lo) return "is-good";
  if (incoming > hi) return "is-bad";
  return "";
}

function buildBlob(g) {
  const vs = Array.isArray(g.variant) ? g.variant : [];
  const variantText = vs.map(v => [
    v?.type,
    v?.price_lower,
    v?.price_average,
    v?.price_higher
  ].join(" ")).join(" ");

  const ratings = g?.ratings || {};
  const ratingsText = [
    ratings.user,
    ratings.fun,
    ratings.collector,
    ratings.technical
  ].join(" ");

  return normalizeText([
    g.title,
    g.manufacturer,
    g.date,
    g.genre,
    g.page,
    g.klov,
    variantText,
    ratingsText,
  ].join(" "));
}

function setSearchNavEnabled(enabled) {
  el.searchPrev.disabled = !enabled;
  el.searchNext.disabled = !enabled;
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

function adsterSnapshotCardHTML(snap, priceClass) {
  if (!snap) return "";

  const title = String(snap.title || "—").trim();
  const priceText = String(snap.priceText || "").trim();

  const distanceTextRaw = String(snap.distanceText || "").trim();
  const distanceMilesNum = Number(snap.distanceMiles);
  const distanceText =
    distanceTextRaw
      ? distanceTextRaw
      : (Number.isFinite(distanceMilesNum) ? distanceMilesNum.toFixed(1) : "");

  const location = String(snap.location || "").trim();
  const desc = String(snap.description || "").trim();
  const adUrl = String(snap.adUrl || "").trim();
  const imageUrl = String(snap.imageUrl || "").trim();
  const source = String(snap.source || "").trim();
  const seller = String(snap.author || "").trim();

  const captionParts = [];
  if (title) captionParts.push(title);
  if (location) captionParts.push(location);
  const caption = captionParts.join(" · ");

  const whoParts = [];
  if (source) whoParts.push(escapeHtml(source));
  if (seller) whoParts.push(escapeHtml(seller));
  const whoLine = whoParts.length ? whoParts.join(" &nbsp;·&nbsp; ") : "";

  const metaParts = [];
  if (priceText) {
    const cls = ["adsterPrice", priceClass].filter(Boolean).join(" ");
    metaParts.push(`<span class="${cls}">${escapeHtml(priceText)}</span>`);
  }
  if (distanceText) {
    metaParts.push(`<span class="adsterDist">${escapeHtml(distanceText)} mi</span>`);
  }
  if (location) {
    metaParts.push(`<span class="adsterLoc">${escapeHtml(location)}</span>`);
  }
  const metaLine = metaParts.length ? metaParts.join(" &nbsp;·&nbsp; ") : "";

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

  const imgBlock = adUrl
    ? `<a class="adsterMediaLink" href="${escapeAttr(adUrl)}" target="_blank" rel="noopener">${imgInner}</a>`
    : `<div class="adsterMediaLink">${imgInner}</div>`;

  const titleBlock = adUrl
    ? `<a class="adsterTitleLink" href="${escapeAttr(adUrl)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
    : `<div class="adsterTitleLink">${escapeHtml(title)}</div>`;

  const descBlock = desc
    ? `<div class="adsterDesc">${escapeHtml(desc)}</div>`
    : "";

  const metaBlock = metaLine
    ? `<div class="adsterMeta">${metaLine}</div>`
    : "";

  const whoBlock = whoLine
    ? `<div class="adsterWho">${whoLine}</div>`
    : "";

  return `
    <article class="adsterCard">
      <div class="adsterCardInner">
        <button
          class="adsterHideBtn"
          type="button"
          title="Dismiss ad card"
          aria-label="Dismiss ad card"
          data-dismiss-adster="1"
        >✕</button>

        <div class="adsterMedia">
          ${imgBlock}
        </div>

        <div class="adsterBody">
          <div class="adsterTitleRow">
            ${titleBlock}
          </div>

          ${metaBlock}
          ${descBlock}
          ${whoBlock}
        </div>
      </div>
    </article>
  `;
}

/* ---------- Modal ---------- */

function buildPageStrip(pageNum) {
  const p = Number(pageNum);
  if (!Number.isFinite(p) || p <= 0) return null;

  return {
    prevSrc: p > 1 ? `images/page_${p - 1}.jpg` : "",
    currSrc: `images/page_${p}.jpg`,
    nextSrc: `images/page_${p + 1}.jpg`,
    prevPage: p > 1 ? p - 1 : null,
    currPage: p,
    nextPage: p + 1,
  };
}

function renderModalPageStrip() {
  const pageNum = Number(modalState.pageNum);
  if (!Number.isFinite(pageNum) || pageNum <= 0) return;

  const strip = buildPageStrip(pageNum);
  if (!strip) return;

  for (const img of [el.imgModalImgPrev, el.imgModalImg, el.imgModalImgNext]) {
    img.removeAttribute("src");
    img.alt = "";
    img.style.display = "none";
  }

  if (modalState.isPageStrip) {
    if (strip.prevSrc) {
      el.imgModalImgPrev.src = strip.prevSrc;
      el.imgModalImgPrev.alt = `Page ${strip.prevPage}`;
      el.imgModalImgPrev.style.display = "";
    }

    el.imgModalImg.src = strip.currSrc;
    el.imgModalImg.alt = `Page ${strip.currPage}`;
    el.imgModalImg.style.display = "";

    if (strip.nextSrc) {
      el.imgModalImgNext.src = strip.nextSrc;
      el.imgModalImgNext.alt = `Page ${strip.nextPage}`;
      el.imgModalImgNext.style.display = "";
    }

    el.imgModalGallery.classList.add("is-page-strip");
  } else {
    el.imgModalImg.src = strip.currSrc;
    el.imgModalImg.alt = `Page ${strip.currPage}`;
    el.imgModalImg.style.display = "";

    el.imgModalGallery.classList.remove("is-page-strip");
  }

  const captionBase = modalState.captionBase || "";
  el.imgModalCaption.textContent = captionBase
    ? `${captionBase.replace(/\s*·\s*Page\s+\d+\s*$/i, "")} · Page ${pageNum}`
    : `Page ${pageNum}`;
}

function openImageModal(src, caption, opts = {}) {
  if (!src) return;

  document.body.style.overflow = "hidden";

  const isPageStrip = !!opts.isPageStrip && Number.isFinite(Number(opts.pageNum));

  modalState.isPageStrip = isPageStrip;
  modalState.pageNum = isPageStrip ? Number(opts.pageNum) : null;
  modalState.captionBase = caption || "";

  el.imgModalPrev.style.display = isPageStrip ? "grid" : "none";
  el.imgModalNext.style.display = isPageStrip ? "grid" : "none";

  if (isPageStrip) {
    renderModalPageStrip();
  } else {
    for (const img of [el.imgModalImgPrev, el.imgModalImg, el.imgModalImgNext]) {
      img.removeAttribute("src");
      img.alt = "";
      img.style.display = "none";
    }

    el.imgModalImg.src = src;
    el.imgModalImg.alt = caption || "";
    el.imgModalImg.style.display = "";

    el.imgModalGallery.classList.remove("is-page-strip");
    el.imgModalCaption.textContent = caption || "";
  }

  el.imgModal.classList.add("is-open");
  el.imgModal.setAttribute("aria-hidden", "false");
}

function closeImageModal() {
  el.imgModal.classList.remove("is-open");
  el.imgModal.setAttribute("aria-hidden", "true");

  for (const img of [el.imgModalImgPrev, el.imgModalImg, el.imgModalImgNext]) {
    img.removeAttribute("src");
    img.alt = "";
    img.style.display = "none";
  }

  el.imgModalGallery.classList.remove("is-page-strip");
  el.imgModalCaption.textContent = "";

  modalState.isPageStrip = false;
  modalState.pageNum = null;
  modalState.captionBase = "";

  el.imgModalPrev.style.display = "none";
  el.imgModalNext.style.display = "none";

  document.body.style.overflow = "";
}

function isModalOpen() {
  return el.imgModal.classList.contains("is-open");
}

function modalCanPage() {
  return isModalOpen() && modalState.isPageStrip && Number.isFinite(Number(modalState.pageNum));
}

function modalGoPrevPage() {
  if (!modalCanPage()) return;
  const nextPage = Math.max(1, Number(modalState.pageNum) - 1);
  if (nextPage === modalState.pageNum) return;
  modalState.pageNum = nextPage;
  renderModalPageStrip();
}

function modalGoNextPage() {
  if (!modalCanPage()) return;
  modalState.pageNum = Number(modalState.pageNum) + 1;
  renderModalPageStrip();
}

/* ---------- Cards ---------- */

function variantLabel(v) {
  return v?.type ? String(v.type) : "Variant";
}

function variantDisplayRange(v) {
  const lo = money(Number(v?.price_lower));
  const hi = money(Number(v?.price_higher));
  return (lo && hi) ? `${lo} – ${hi}` : (lo || hi || "—");
}

function groupVariantsByRange(vs) {
  const groups = new Map();

  for (const v of vs) {
    const rangeText = variantDisplayRange(v);

    // Group strictly by the actual numeric pair when possible.
    // Fallback to display text if values are missing.
    const lo = Number(v?.price_lower);
    const hi = Number(v?.price_higher);
    const key =
      Number.isFinite(lo) || Number.isFinite(hi)
        ? `${Number.isFinite(lo) ? lo : ""}|${Number.isFinite(hi) ? hi : ""}`
        : `txt:${rangeText}`;

    if (!groups.has(key)) {
      groups.set(key, {
        rangeText,
        types: [],
      });
    }

    groups.get(key).types.push(variantLabel(v));
  }

  return Array.from(groups.values());
}

function formatVariantTypeSummary(types) {
  const clean = types.map(t => String(t || "").trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] || "Variant";
  return clean.join(" / ");
}

function cardHTML(g, idx) {
  const title = g.title || "—";
  const mfg = g.manufacturer || null;
  const date = g.date || null;
  const genre = g.genre || null;
  let page = (g.page == null) ? null : String(g.page);

  const klovUrl = g.klov
    ? String(g.klov)
    : (
      "https://www.arcade-museum.com/searchResults?q=" +
      encodeURIComponent(title) +
      "&boolean=AND"
    );

  const line1 = `
  <div class="lineTitle">
    <a
      class="titleText"
      href="${escapeAttr(klovUrl)}"
      target="_blank"
      rel="noopener"
    >
      ${escapeHtml(title)}
    </a>
  </div>`;

  const line2Parts = [];
  if (mfg) line2Parts.push(`<span class="mfgText">${escapeHtml(mfg)}</span>`);
  if (date) line2Parts.push(`<span class="metaMain">${escapeHtml(date)}</span>`);
  const line2 = line2Parts.length
    ? `<div class="lineMeta lineMetaMain">${line2Parts.join(" – ")}</div>`
    : "";

  const lineGenre = genre
    ? `<div class="lineMeta lineMetaGenre">${escapeHtml(genre)}</div>`
    : "";

  const ratingsLine = ratingsSummaryHTML(g.ratings);
  const ratingsBlock = ratingsLine
    ? `<div class="lineMeta ratingsLine">${ratingsLine}</div>`
    : "";

  const vs = Array.isArray(g.variant) ? g.variant : [];
  let variantsBlock = "";

  if (vs.length) {
    const grouped = groupVariantsByRange(vs);

    variantsBlock = grouped.map(group => `
    <div class="variantRow">
      <span class="variantType">${escapeHtml(formatVariantTypeSummary(group.types))}</span>
      <span class="variantRange">${escapeHtml(group.rangeText)}</span>
    </div>
  `).join("");
  }

  let pageBtn = "";

  if (page) {
    const pageNum = Number(page);
    const pageSrc = `images/page_${pageNum}.jpg`;
    const pageCaption = `${title} · Page ${pageNum}`;

    pageBtn = `
    <button
      class="pageBtn"
      type="button"
      data-page-src="${escapeAttr(pageSrc)}"
      data-page-caption="${escapeAttr(pageCaption)}"
      data-page-num="${pageNum}"
      aria-label="Open page ${escapeAttr(page)}"
      title="${escapeAttr(page)}"
    >
      ${escapeHtml(page)}
    </button>
  `;
  }

  const bottomLine = (ratingsLine || pageBtn)
    ? `
      <div class="lineMeta lineMetaBottom">
        <span class="bottomMetaLeft">${ratingsLine || ""}</span>
        ${pageBtn}
      </div>
    `
    : "";

  const imgSrc = g.image ? `images/${g.image}` : "questionmark.png";
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

  const key = machineKey(g);

  return `
  <article class="card" data-idx="${idx}">
    <button class="cardHideBtn" type="button" title="Hide this match" aria-label="Hide this match"
            data-hide-key="${escapeAttr(key)}">✕</button>
    <div class="thumbWrap" role="button" tabindex="0" aria-label="View image: ${escapeAttr(title)}">
      ${imgTag}
    </div>
    <div class="cardBody">
      ${line1}
      ${line2}
      ${lineGenre}
      ${ratingsBlock}
      ${variantsBlock}
    </div>
    ${bottomLine}
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

function scheduleAutoHideCreditCard() {
  clearTimeout(scheduleAutoHideCreditCard._t);

  const cc = el.cards.querySelector(".creditCard");
  if (!cc) return;

  scheduleAutoHideCreditCard._t = setTimeout(() => {
    cc.classList.add("is-hiding");

    setTimeout(() => {
      try { cc.remove(); } catch (_) {
        try { cc.parentNode && cc.parentNode.removeChild(cc); } catch (_) { }
      }
      creditCardGone = true;
    }, 230);
  }, 3000);
}

function renderCards() {
  const cardsHtml = filtered.map((g, idx) => cardHTML(g, idx)).join("\n");

  let adsterHtml = "";
  if (openedWithSearchParam && !adsterCardDismissed) {
    const snap = loadAdsterSnapshot();
    if (snap) {
      const priceClass = adsterPriceClassForCurrentResults(snap);
      adsterHtml = adsterSnapshotCardHTML(snap, priceClass);
    }
  }

  el.cards.innerHTML = (creditCardGone ? "" : creditCardHTML()) + adsterHtml + cardsHtml;

  rebuildKeyIndex();
  updateActiveKeyFromScroll();
  setupImageObserver();

  scheduleAutoHideCreditCard();
}

/* ---------- Search ---------- */

function runSearch(rawQuery) {
  lastQuery = rawQuery || "";

  const raw = String(rawQuery || "").trim();
  const qNorm = normalizeText(raw);
  const terms = qNorm ? qNorm.split(" ").filter(Boolean) : [];
  const joinedTerms = terms.map(t => normalizeNoSpace(t)).filter(Boolean);

  const wantsHyphenExact = /[-–—]/.test(raw);
  const qJoined = qNorm.replace(/\s+/g, "");
  const qJoinedLen = qJoined.length;

  if (terms.length === 0) {
    hiddenKeys.clear(); // reset hidden matches when search is cleared
    filtered = games.slice();
    filteredBlobs = filtered.map(buildBlob);
    filteredJoinedBlobs = filteredBlobs.map(normalizeNoSpace);
    matches = [];
    matchPos = 0;
    setSearchNavEnabled(false);
    renderSearchStatus();
    renderCards();
    return;
  }

  const out = [];
  const blobs = [];
  const joinedBlobs = [];

  for (const g of games) {
    const b = buildBlob(g);
    const bJoined = normalizeNoSpace(b);

    let hit =
      terms.every(t => b.includes(t)) ||
      (joinedTerms.length > 0 && joinedTerms.every(t => bJoined.includes(t)));

    // Keep the current stricter hyphen behavior:
    // if user explicitly types a hyphen, only compare against the title with spaces removed
    if (wantsHyphenExact && qJoinedLen >= 2) {
      const titleJoined = normalizeNoSpace(g.title || "");
      hit = titleJoined.includes(qJoined);
    }

    if (hit) {
      out.push(g);
      blobs.push(b);
      joinedBlobs.push(bJoined);
    }
  }

  // apply in-session hides
  const out2 = [];
  const blobs2 = [];
  const joinedBlobs2 = [];

  for (let i = 0; i < out.length; i++) {
    if (hiddenKeys.has(machineKey(out[i]))) continue;
    out2.push(out[i]);
    blobs2.push(blobs[i]);
    joinedBlobs2.push(joinedBlobs[i]);
  }

  filtered = out2;
  filteredBlobs = blobs2;
  filteredJoinedBlobs = joinedBlobs2;

  matches = [];
  for (let i = 0; i < filtered.length; i++) {
    const g = filtered[i];
    const b = filteredBlobs[i];
    const bJoined = filteredJoinedBlobs[i];

    let hit =
      terms.every(t => b.includes(t)) ||
      (joinedTerms.length > 0 && joinedTerms.every(t => bJoined.includes(t)));

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

function buildParallelGuideUrl(currentSearchText) {
  // pins: /priceguide/pins   -> /priceguide/vag/
  // vag:  /priceguide/vag/   -> /priceguide/pins
  const path = String(window.location.pathname || "");
  const isVag = /\/priceguide\/vag\/?$/i.test(path);

  const targetPath = isVag ? "/priceguide/pins" : "/priceguide/vag/";

  // Always include s= (even blank) so behavior matches the Adster entry logic.
  const q = String(currentSearchText || "").trim();
  const qs = `?s=${encodeURIComponent(q)}`;

  return `${window.location.origin}${targetPath}${qs}`;
}

/* ---------- Wiring ---------- */

function wireUI() {
  buildAZButtons();

  el.switchGuide?.addEventListener("click", () => {
    const q = el.searchInput?.value || "";
    window.location.assign(buildParallelGuideUrl(q)); // same tab
  });

  el.railKeys.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-key]");
    if (!btn) return;
    onRailKeyClick(btn.dataset.key);
  });

  el.imgModalPrev?.addEventListener("click", (e) => {
    e.stopPropagation();
    modalGoPrevPage();
  });

  el.imgModalNext?.addEventListener("click", (e) => {
    e.stopPropagation();
    modalGoNextPage();
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

    const dismissAdsterBtn = e.target.closest("button[data-dismiss-adster]");
    if (dismissAdsterBtn) {
      e.preventDefault();
      e.stopPropagation();
      dismissAdsterCard();
      return;
    }

    const hideBtn = e.target.closest("button[data-hide-key]");
    if (hideBtn) {
      e.preventDefault();
      e.stopPropagation();

      const key = hideBtn.getAttribute("data-hide-key") || "";
      if (key) hiddenKeys.add(key);

      runSearch(el.searchInput?.value || "");
      return;
    }

    const pageBtn = e.target.closest(".pageBtn");
    if (pageBtn) {
      e.preventDefault();
      e.stopPropagation();

      const src = pageBtn.getAttribute("data-page-src") || "";
      const caption = pageBtn.getAttribute("data-page-caption") || "";
      const pageNum = Number(pageBtn.getAttribute("data-page-num"));
      openImageModal(src, caption, { isPageStrip: true, pageNum });
      return;
    }

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
    if (!isModalOpen()) return;

    if (e.key === "Escape") {
      closeImageModal();
      return;
    }

    if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      modalGoPrevPage();
      return;
    }

    if (e.key === "ArrowRight" || e.key === "PageDown") {
      e.preventDefault();
      modalGoNextPage();
      return;
    }
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
      klov: g.klov ?? null,
      ratings: (g.ratings && typeof g.ratings === "object") ? {
        user: g.ratings.user ?? null,
        fun: g.ratings.fun ?? null,
        collector: g.ratings.collector ?? null,
        technical: g.ratings.technical ?? null,
      } : null,
    }));

  games.sort((a, b) => {
    const ta = titleSortKey(a.title);
    const tb = titleSortKey(b.title);

    return ta.localeCompare(tb, undefined, {
      sensitivity: "base",
      numeric: false
    });
  });

  filtered = games.slice();
  filteredBlobs = filtered.map(buildBlob);
  filteredJoinedBlobs = filteredBlobs.map(normalizeNoSpace);
}

function applyIncomingSearchParam() {
  let pending = "";
  openedWithSearchParam = false;

  try {
    const params = new URLSearchParams(window.location.search);

    // Treat presence of "s" (even blank ?s=) as "opened from Adster"
    const hasS = params.has("s");
    const s = params.get("s"); // may be "" if ?s=
    if (hasS) {
      openedWithSearchParam = true;
      pending = String(s || "").trim(); // may stay ""
    }

    // Clean URL if Adster launched us (hasS), even if search text is empty
    if (hasS) {
      const clean = window.location.pathname + window.location.hash;
      history.replaceState(null, "", clean);
    }
  } catch (_) { }

  // If s had actual terms, run the search. Otherwise show full list.
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