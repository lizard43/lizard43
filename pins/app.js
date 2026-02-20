"use strict";

/*
  Expects ps_machines_merged.json in the same folder:
    { "generated_at": "...", "machines": [ ... ] }

  Supports incoming URL param:
    ?s=search terms

  IMPORTANT: true lazy image loading
    - We do NOT set <img src> initially.
    - We set data-src and use IntersectionObserver to populate src only when near viewport.
*/

const DATA_URL = "ps_machines_merged.json";
const PINSIDE_TAB_NAME = "pinside_tab";

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
};

let machines = [];
let generatedAt = null;
let filtered = [];
let filteredBlobs = [];
let matches = [];
let matchPos = 0;
let lastQuery = "";

let keyBtns = {};
let keyToIndex = {};
let activeKey = null;

let imgObserver = null;

function openPinsideInReusableTab(url) {
  if (!url) return;
  const w = window.open(url, PINSIDE_TAB_NAME);
  try { w?.focus?.(); } catch (_) { }
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

function firstKeyForName(name) {
  const n = normalizeText(name);
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

function valueLine(m) {
  const lo = m.lowvalue;
  const hi = m.highvalue;
  if (lo == null || hi == null) return null;
  if (!Number.isFinite(Number(lo)) || !Number.isFinite(Number(hi))) return null;
  return `${money(lo)} – ${money(hi)}`;
}

function buildBlob(m) {
  return normalizeText([
    m.name,
    m.manufacturer,
    m.date,
    m.type,
    m.players,
    m.pinsideID,
    m.msrp,
    m.lowvalue, m.highvalue, m.avgvalue,
    m.score
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
  const m = filtered[matches[matchPos]];
  el.searchStatus.textContent = `${matchPos + 1}/${matches.length}: ${m.name}`;
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
    const k = firstKeyForName(filtered[i].name);
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

  const k = firstKeyForName(filtered[bestIdx]?.name);
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

function cardHTML(m, idx) {
  const pinsideUrl = m.url || "";
  const mfgName = m.manufacturer || "";
  const mfgUrl = m.manufacturerURL || "";

  const date = m.date || null;
  const type = m.type || null;
  const players = (m.players == null) ? null : String(m.players);

  const vLine = valueLine(m);
  const msrp = (m.msrp == null) ? null : money(Number(m.msrp));
  const score = (m.score == null) ? null : Number(m.score).toFixed(3);

  const line1 = `
    <div class="lineTitle">
      ${pinsideUrl
      ? `<a class="titleLink" href="${escapeAttr(pinsideUrl)}" rel="noopener">${escapeHtml(m.name || "—")}</a>`
      : `<span class="titleText">${escapeHtml(m.name || "—")}</span>`
    }
    </div>`;

  const line2Parts = [];
  if (mfgName) {
    line2Parts.push(
      mfgUrl
        ? `<a class="mfgLink" href="${escapeAttr(mfgUrl)}" rel="noopener">${escapeHtml(mfgName)}</a>`
        : `<span class="mfgText">${escapeHtml(mfgName)}</span>`
    );
  }
  if (date) line2Parts.push(`<span class="dim"> ${escapeHtml(date)}</span>`);
  const line2 = line2Parts.length ? `<div class="lineMeta">${line2Parts.join(" · ")}</div>` : "";

  const line3Parts = [];
  if (vLine) line3Parts.push(`<span class="priceStrong">${escapeHtml(vLine)}</span>`);
  if (msrp) line3Parts.push(`<span class="dim">MSRP ${escapeHtml(msrp)}</span>`);
  const line3 = line3Parts.length ? `<div class="lineMeta">${line3Parts.join(" · ")}</div>` : "";

  const line4Parts = [];
  if (type) line4Parts.push(`<span>${escapeHtml(type)}</span>`);
  if (players) line4Parts.push(`<span class="dim">${escapeHtml(players)}P</span>`);
  const line4 = line4Parts.length ? `<div class="lineMeta">${line4Parts.join(" · ")}</div>` : "";

  let line5 = "";

  if (score) {
    const ratingsUrl = pinsideUrl
      ? `${pinsideUrl.replace(/\/$/, "")}/ratings`
      : null;

    line5 = `
    <div class="lineMeta">
      Score ${ratingsUrl
        ? `<a href="${escapeAttr(ratingsUrl)}" rel="noopener"><strong>${escapeHtml(score)}</strong></a>`
        : `<strong>${escapeHtml(score)}</strong>`
      }
    </div>`;
  }

  const imgSrc = m.imageUrl || "questionmark.png";

  const imgTag = `
  <img 
    class="thumb js-lazy"
    data-src="${escapeAttr(imgSrc)}"
    alt="${escapeAttr(m.name || "Unknown machine")}"
    decoding="async"
  >
`;

  const thumb = pinsideUrl
    ? `<a class="thumbLink" href="${escapeAttr(pinsideUrl)}" rel="noopener">${imgTag}</a>`
    : imgTag;

  return `
  <article class="card" data-idx="${idx}">
    <div class="thumbWrap">
      ${thumb}
    </div>
    <div class="cardBody">
      ${line1}
      ${line2}
      ${line3}
      ${line4}
      ${line5}
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
      <img
        src="pinside-logo-website.svg"
        alt="Pinside Logo"
        class="creditLogo"
        loading="lazy"
      />
      <div class="creditText">
        <div class="creditLine">
          Game info and prices are property of <a href="https://pinside.com" rel="noopener">pinside.com</a>
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
  const cardsHtml = filtered.map((m, idx) => cardHTML(m, idx)).join("\n");
  el.cards.innerHTML = creditCardHTML() + cardsHtml;

  rebuildKeyIndex();
  updateActiveKeyFromScroll();
  setupImageObserver();
}

function runSearch(rawQuery) {
  lastQuery = rawQuery || "";

  const raw = String(rawQuery || "").trim();
  const qNorm = normalizeText(raw);                 // e.g. "f 14"
  const terms = qNorm ? qNorm.split(" ").filter(Boolean) : [];

  // special: if user typed a hyphen, prefer matching the joined form in the NAME only
  const wantsHyphenExact = /[-–—]/.test(raw);       // hyphen/en-dash/em-dash
  const qJoined = terms.join("");                   // e.g. "f14"
  const qJoinedLen = qJoined.length;

  if (terms.length === 0) {
    filtered = machines.slice();
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

  for (const m of machines) {
    const b = buildBlob(m);

    // AND semantics across the blob (your normal behavior)
    let hit = terms.every(t => b.includes(t));

    // If the user typed a hyphen, tighten: require the joined token to appear in the NAME
    // This prevents "f"+"14" from matching random numeric fields.
    if (wantsHyphenExact && qJoinedLen >= 2) {
      const nameJoined = normalizeNoSpace(m.name || "");
      hit = nameJoined.includes(qJoined);
    }

    if (hit) {
      out.push(m);
      blobs.push(b);
    }
  }

  filtered = out;
  filteredBlobs = blobs;

  matches = [];
  for (let i = 0; i < filtered.length; i++) {
    const m = filtered[i];
    const b = filteredBlobs[i];

    let hit = terms.every(t => b.includes(t));

    if (wantsHyphenExact && qJoinedLen >= 2) {
      const nameJoined = normalizeNoSpace(m.name || "");
      hit = nameJoined.includes(qJoined);
    }

    if (hit) matches.push(i);
  }

  matchPos = 0;
  setSearchNavEnabled(matches.length > 0);
  renderSearchStatus();
  renderCards();

  if (matches.length > 0) jumpToMatch(0);
}

function jumpToMatch(pos) {
  if (matches.length === 0) return;
  const n = matches.length;
  matchPos = ((pos % n) + n) % n;

  const idx = matches[matchPos];
  const m = filtered[idx];
  renderSearchStatus();

  const k = firstKeyForName(m?.name);
  setActiveKey(k);
  scrollToCardIndex(idx);
  showToast(m?.name || "Match");
}

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

  el.cards.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;

    const href = a.getAttribute("href") || "";
    if (!href) return;

    // Only intercept pinside.com links
    if (/^https:\/\/pinside\.com\//i.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      openPinsideInReusableTab(href);
    }
  });

  let raf = false;
  el.stage.addEventListener("scroll", () => {
    if (raf) return;
    raf = true;
    requestAnimationFrame(() => {
      raf = false;
      updateActiveKeyFromScroll();
    });
  }, { passive: true });
}

async function loadData() {
  const res = await fetch(DATA_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: HTTP ${res.status}`);
  const data = await res.json();

  if (!data || !Array.isArray(data.machines)) {
    throw new Error("JSON must be: { \"machines\": [...] }");
  }

  generatedAt = data.generated_at || null;

  machines = data.machines
    .filter(m => m && typeof m === "object")
    .map(m => ({
      ...m,
      name: m.name ?? "",
      url: m.url ?? "",
      manufacturer: m.manufacturer ?? null,
      manufacturerURL: m.manufacturerURL ?? null,
      imageUrl: m.imageUrl ?? null,
    }));

  machines.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true }));

  filtered = machines.slice();
  filteredBlobs = filtered.map(buildBlob);
}

function applyIncomingSearchParam() {
  let pending = "";
  try {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("s");
    if (s && String(s).trim()) pending = String(s).trim();

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
    el.cards.innerHTML = `<div class="lineMeta">Failed to load data. Put <strong>${DATA_URL}</strong> next to index.html and run a local web server.</div>`;
    showToast("Data load failed");
  }
}

init();
