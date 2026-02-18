"use strict";

/*
  Expects pinside_machines.json in the same folder:
    { "machines": [ ... ] }

  Supports incoming URL param:
    ?s=search terms

  Right rail:
    - A..Z jumps to first visible card of that letter (based on current filtered list)
    - Prev/Next cycles search matches

  Notes:
    - If you open index.html directly with file://, fetch() may be blocked.
      Use a simple local server (e.g. `python3 -m http.server`).
*/

const DATA_URL = "pinside_machines_sorted.json";

const el = {
  stage: document.getElementById("stage"),
  cards: document.getElementById("cards"),
  toast: document.getElementById("toast"),

  searchInput: document.getElementById("searchInput"),
  searchClear: document.getElementById("searchClear"),
  searchPrev: document.getElementById("searchPrev"),
  searchNext: document.getElementById("searchNext"),
  searchStatus: document.getElementById("searchStatus"),
  countStatus: document.getElementById("countStatus"),

  railKeys: document.getElementById("railKeys"),
  btnPrev: document.getElementById("btnPrev"),
  btnNext: document.getElementById("btnNext"),
  btnGear: document.getElementById("btnGear"),
};

let machines = [];
let filtered = [];
let filteredBlobs = [];     // searchable strings aligned with filtered[]
let matches = [];           // indices into filtered[]
let matchPos = 0;
let lastQuery = "";

let keyBtns = {};           // { "A": <button>, ... }
let keyToIndex = {};        // { "A": 12, ... } first index in filtered[] for that letter
let activeKey = null;

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.remove("show"), 900);
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")  // strip accents
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

function fmtRange(m) {
  const lo = m.lowvalue;
  const hi = m.highvalue;
  const avg = m.avgvalue;

  if (lo == null && hi == null) return "Value: —";
  if (lo != null && hi != null && lo !== hi) return `Value: ${money(lo)} – ${money(hi)} (avg ${money(avg)})`;
  if (lo != null) return `Value: ${money(lo)}`;
  return "Value: —";
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
  el.btnPrev.disabled = !enabled;
  el.btnNext.disabled = !enabled;
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

function renderCountStatus() {
  const total = machines.length;
  const shown = filtered.length;
  el.countStatus.textContent = `${shown.toLocaleString()}/${total.toLocaleString()}`;
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
    // keep it visible in rail
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
  // Scroll the stage so the card is visible under topbar
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

  // find first card whose top is within viewport-ish
  const stageTop = el.stage.getBoundingClientRect().top;
  let bestIdx = null;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (r.bottom > stageTop + 8) { // first visible-ish
      bestIdx = Number(c.dataset.idx);
      break;
    }
  }
  if (bestIdx == null || !Number.isFinite(bestIdx)) return;

  const k = firstKeyForName(filtered[bestIdx]?.name);
  if (k && k !== activeKey) setActiveKey(k);
}

function cardHTML(m, idx) {
  const score = (m.score == null) ? null : Number(m.score).toFixed(3);
  const msrp = (m.msrp == null) ? null : money(Number(m.msrp));

  const badges = [];
  if (m.type) badges.push(`<span class="badge">${escapeHtml(m.type)}</span>`);
  if (m.players != null) badges.push(`<span class="badge">${escapeHtml(String(m.players))}P</span>`);
  if (score != null) badges.push(`<span class="badge">Score ${escapeHtml(score)}</span>`);

  const mfgLine = [
    m.manufacturer ? `<strong>${escapeHtml(m.manufacturer)}</strong>` : "<strong>—</strong>",
    m.date ? escapeHtml(m.date) : "—",
  ].join(" · ");

  const msrpLine = `MSRP: ${msrp ?? "—"}`;
  const valLine = escapeHtml(fmtRange(m));

  const img = m.imageUrl
    ? `<img class="thumb" loading="lazy" decoding="async" src="${escapeAttr(m.imageUrl)}" alt="${escapeAttr(m.name)}">`
    : `<div class="thumbFallback">No image</div>`;

  const mfgUrl = m.manufacturerURL ? m.manufacturerURL : null;

  return `
  <article class="card" data-idx="${idx}">
    <div class="thumbWrap">
      ${img}
    </div>
    <div class="cardBody">
      <div class="cardTitleRow">
        <h3 class="cardTitle">${escapeHtml(m.name || "—")}</h3>
        <div class="badges">${badges.join("")}</div>
      </div>

      <div class="metaLine">${mfgLine}</div>
      <div class="metaLine">${escapeHtml(msrpLine)} · ${valLine}</div>

      <div class="actions">
        ${m.url ? `<a class="linkBtn" href="${escapeAttr(m.url)}" target="_blank" rel="noopener">Open</a>` : ""}
        ${mfgUrl ? `<a class="linkBtn" href="${escapeAttr(mfgUrl)}" target="_blank" rel="noopener">Mfg</a>` : ""}
      </div>
    </div>
  </article>`;
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
  // for attributes like src/href
  return escapeHtml(s).replace(/`/g, "&#96;");
}

function renderCards() {
  const html = filtered.map((m, idx) => cardHTML(m, idx)).join("\n");
  el.cards.innerHTML = html;
  rebuildKeyIndex();
  renderCountStatus();
  updateActiveKeyFromScroll();
}

function runSearch(rawQuery) {
  lastQuery = rawQuery || "";
  const q = normalizeText(rawQuery);

  if (!q) {
    filtered = machines.slice();
    filteredBlobs = filtered.map(buildBlob);
    matches = [];
    matchPos = 0;
    setSearchNavEnabled(false);
    renderSearchStatus();
    renderCards();
    return;
  }

  // filter
  const out = [];
  const blobs = [];
  for (const m of machines) {
    const b = buildBlob(m);
    if (b.includes(q)) {
      out.push(m);
      blobs.push(b);
    }
  }
  filtered = out;
  filteredBlobs = blobs;

  // match nav uses filtered list
  matches = [];
  for (let i = 0; i < filteredBlobs.length; i++) {
    if (filteredBlobs[i].includes(q)) matches.push(i);
  }
  matchPos = 0;

  setSearchNavEnabled(matches.length > 0);
  renderSearchStatus();
  renderCards();

  if (matches.length > 0) {
    jumpToMatch(0);
  }
}

function jumpToMatch(pos) {
  if (matches.length === 0) return;
  const n = matches.length;
  matchPos = ((pos % n) + n) % n;

  const idx = matches[matchPos];
  const m = filtered[idx];
  renderSearchStatus();

  // jump + toast
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
  el.btnPrev.addEventListener("click", () => jumpToMatch(matchPos - 1));
  el.btnNext.addEventListener("click", () => jumpToMatch(matchPos + 1));

  el.btnGear.addEventListener("click", () => {
    showToast("Settings (todo)");
  });

  // highlight the current letter while scrolling
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

  // Defensive: ensure url exists & is absolute if possible
  machines = data.machines
    .filter(m => m && typeof m === "object")
    .map(m => ({
      ...m,
      name: m.name ?? "",
      url: m.url ?? "",
      manufacturer: m.manufacturer ?? null,
    }));

  // default sort by name (stable-ish)
  machines.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true }));

  // initial view
  filtered = machines.slice();
  filteredBlobs = filtered.map(buildBlob);
}

function applyIncomingSearchParam() {
  let pending = "";
  try {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("s");
    if (s && String(s).trim()) pending = String(s).trim();

    // clean URL (keep hash if any)
    if (pending) {
      const clean = window.location.pathname + window.location.hash;
      history.replaceState(null, "", clean);
    }
  } catch (_) {}

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
    renderCountStatus();
  } catch (e) {
    console.error(e);
    el.cards.innerHTML = `<div class="metaLine">Failed to load data. Put <strong>${DATA_URL}</strong> next to index.html and run a local web server.</div>`;
    showToast("Data load failed");
  }
}

init();
