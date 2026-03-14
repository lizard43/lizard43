(() => {

  const API_URL = 'https://script.google.com/macros/s/AKfycbyfpebveJYArafZ2FaMWNTT5IYrkwdc56vOyGA8CrStTu1dXiqvIanfS_YQtMJdVu53kA/exec';

  const state = {
    allMachines: [],
    filteredMachines: [],
    selectedId: null,
    priceguideEntries: [],
    priceguideByTitle: new Map(),
    priceguideById: new Map()
  };

  const els = {
    searchInput: document.getElementById("searchInput"),
    locationFilter: document.getElementById("locationFilter"),
    conditionFilter: document.getElementById("conditionFilter"),
    addMachineBtn: document.getElementById("addMachineBtn"),
    cardsGrid: document.getElementById("cardsGrid"),
    emptyState: document.getElementById("emptyState"),
    detailPane: document.getElementById("detailPane"),
    detailTitle: document.getElementById("detailTitle"),
    detailContent: document.getElementById("detailContent"),
    closeDetailBtn: document.getElementById("closeDetailBtn"),
    mobileOverlay: document.getElementById("mobileOverlay")
  };

  async function apiGet(params) {
    const url = new URL(API_URL);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, v);
      }
    });

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`API request failed: HTTP ${res.status}`);
    }

    return res.json();
  }

  window.InventoryLoader = {
    async load() {
      const payload = await apiGet({ resource: "games" });

      if (!payload || payload.ok !== true || !Array.isArray(payload.data)) {
        throw new Error("Games API returned invalid data.");
      }

      return payload.data.map(normalizeMachine);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function normalizeMachine(machine) {
    const item = { ...machine };
    const pg = getPriceguideEntryFromPgId(item.pgID) || null;

    item.id = String(item.ID || item.id || "").trim();
    item.title = String(item.title || pg?.title || "").trim();
    item.pgID = String(item.pgID || "").trim();

    item.year = pg?.date || null;
    item.manufacturer = String(pg?.manufacturer || "").trim();
    item.genre = String(pg?.genre || "").trim();

    item.location = String(item.location || "").trim();
    item.condition = String(item.condition || "").trim();

    item.purchaseDate = String(item.purchaseDate || "").trim();
    item.purchasePrice = toNumberOrNull(item.purchasePrice);
    item.purchaseFrom = String(item.purchaseFrom || "").trim();

    item.notes = String(item.notes || "").trim();

    item.totalExpenses = null;
    item.totalCost = null;
    item.expenses = [];

    item.photo = String(item.photo || "").trim();
    item.photos = [];

    item.klov = String(pg?.klov || "").trim();

    item.soldDate = String(item.soldDate || "").trim();
    item.soldPrice = toNumberOrNull(item.soldPrice);
    item.soldTo = String(item.soldTo || "").trim();

    return item;
  }

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async function loadPriceguide() {
    const url = "../priceguide/vag/vagal_norm4.json";

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("Priceguide JSON must be an array.");
      }

      state.priceguideEntries = data;
      state.priceguideByTitle = new Map();
      state.priceguideById = new Map();

      for (const entry of data) {
        const titleKey = normalizeLookupTitle(entry.title);
        if (titleKey && !state.priceguideByTitle.has(titleKey)) {
          state.priceguideByTitle.set(titleKey, entry);
        }

        const idKey = String(entry.id || "").trim();
        if (idKey && !state.priceguideById.has(idKey)) {
          state.priceguideById.set(idKey, entry);
        }
      }

      console.log(`[priceguide] loaded ${state.priceguideEntries.length} entries`);
    } catch (err) {
      console.warn(`[priceguide] failed to load ${url}: ${err.message}`);
      state.priceguideEntries = [];
      state.priceguideByTitle = new Map();
      state.priceguideById = new Map();
    }
  }

  function normalizeLookupTitle(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/&/g, "and")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getPriceguideEntryFromPgId(pgID) {
    const key = String(pgID || "").trim();
    if (!key) return null;
    return state.priceguideById.get(key) || null;
  }

  function getPriceguideEntry(machine) {
    return (
      getPriceguideEntryFromPgId(machine.pgID) ||
      state.priceguideByTitle.get(normalizeLookupTitle(machine.title)) ||
      null
    );
  }

  function getPriceguideImageUrl(filename) {
    if (!filename) return "";
    if (/^https?:\/\//i.test(filename)) return filename;
    return `../priceguide/vag/images/${filename}`;
  }

  function formatRating(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return String(Number(n.toFixed(2)));
  }

  function formatPriceguideRange(entry) {
    if (!entry || !Array.isArray(entry.variant) || entry.variant.length === 0) return "—";

    const lows = entry.variant
      .map(v => Number(v.price_lower))
      .filter(Number.isFinite);

    const highs = entry.variant
      .map(v => Number(v.price_higher))
      .filter(Number.isFinite);

    if (!lows.length && !highs.length) return "—";

    const low = lows.length ? Math.min(...lows) : null;
    const high = highs.length ? Math.max(...highs) : null;

    if (low != null && high != null) {
      return `${formatMoney(low)} – ${formatMoney(high)}`;
    }

    return formatMoney(low ?? high);
  }

  async function init() {
    wireEvents();

    try {
      await loadPriceguide();
      state.allMachines = await window.InventoryLoader.load();
      populateFilters();
      applyFilters();

    } catch (err) {
      els.cardsGrid.innerHTML = "";
      els.emptyState.classList.remove("hidden");
      els.emptyState.textContent = `Could not load inventory. ${err.message}`;
    }
  }

  function wireEvents() {
    els.searchInput.addEventListener("input", applyFilters);
    els.locationFilter.addEventListener("change", applyFilters);
    els.conditionFilter.addEventListener("change", applyFilters);

    els.addMachineBtn.addEventListener("click", () => {
      alert("Add machine form can be wired next.");
    });

    els.closeDetailBtn.addEventListener("click", closeMobileDetail);
    els.mobileOverlay.addEventListener("click", closeMobileDetail);

    window.addEventListener("resize", updateSelectedCard);
  }

  function isSoldMachine(machine) {
    return !!String(machine?.soldDate || "").trim();
  }

  function getEffectiveCondition(machine) {
    return isSoldMachine(machine) ? "sold" : String(machine?.condition || "").trim();
  }

  function populateFilters() {
    const locations = uniqueSorted(state.allMachines.map(m => m.location).filter(Boolean));
    const conditions = uniqueSorted(state.allMachines.map(getEffectiveCondition).filter(Boolean));

    fillSelect(els.locationFilter, "All locations", locations);
    fillSelect(els.conditionFilter, "All conditions", conditions);
  }

  function fillSelect(selectEl, defaultLabel, values) {
    selectEl.innerHTML = "";
    selectEl.appendChild(new Option(defaultLabel, ""));

    for (const value of values) {
      selectEl.appendChild(new Option(value, value));
    }
  }

  function applyFilters() {
    const q = els.searchInput.value.trim().toLowerCase();
    const location = els.locationFilter.value;
    const condition = els.conditionFilter.value;

    state.filteredMachines = state.allMachines.filter(machine => {
      const effectiveCondition = getEffectiveCondition(machine);

      if (location && machine.location !== location) return false;

      if (condition) {
        if (effectiveCondition !== condition) return false;
      } else {
        if (effectiveCondition === "sold") return false;
      }

      if (!q) return true;

      const pg = getPriceguideEntry(machine);

      const blob = [
        machine.id,
        machine.title,
        machine.location,
        effectiveCondition,
        machine.condition,
        machine.notes,
        machine.purchaseFrom,
        machine.pgID,
        pg?.manufacturer || machine.manufacturer,
        pg?.genre || machine.genre,
        pg?.date || machine.year
      ]
        .join(" ")
        .toLowerCase();

      return blob.includes(q);
    });

    renderCards();

    if (window.innerWidth < 1000) {
      if (!state.filteredMachines.some(m => m.id === state.selectedId)) {
        if (state.filteredMachines.length === 0) {
          state.selectedId = null;
          renderDetail(null);
        }
      } else {
        updateSelectedCard();
      }
    }
  }

  function renderCards() {
    els.cardsGrid.innerHTML = "";

    if (state.filteredMachines.length === 0) {
      els.emptyState.classList.remove("hidden");
      return;
    }

    els.emptyState.classList.add("hidden");

    for (const machine of state.filteredMachines) {
      const row = document.createElement("div");
      row.className = "machineRow";
      row.dataset.id = machine.id;

      const card = document.createElement("article");
      card.className = "card";
      card.dataset.id = machine.id;

      if (machine.id === state.selectedId) {
        card.classList.add("selected");
      }

      const pg = getPriceguideEntry(machine);
      const cardImageUrl = getCardPhotoUrl(machine);
      const klovUrl = machine.klov || pg?.klov || "";

      card.innerHTML = `
      <div class="cardPhotoWrap">
        <img class="cardPhoto" src="${escapeAttr(cardImageUrl)}" alt="${escapeAttr(machine.title)}">
      </div>

      <div class="cardBody">

        <div class="cardHeader">
          <h3 class="cardTitle">${escapeHtml(machine.title)}</h3>
          <span class="cardGameId">${escapeHtml(machine.id)}</span>
        </div>

        <div class="cardFooter">
          <div class="cardFooterMeta">${escapeHtml(
        formatLocationCondition(machine)
      )}</div>
          <button class="detailsBtn" type="button">Details &raquo;</button>
        </div>

      </div>
    `;

      card.addEventListener("click", event => {
        const clickedKlov = event.target.closest("a");
        const clickedDetails = event.target.closest(".detailsBtn");
        if (clickedKlov || clickedDetails) return;

        selectMachine(machine.id, true);
      });

      const detailsBtn = card.querySelector(".detailsBtn");
      detailsBtn.addEventListener("click", event => {
        event.stopPropagation();
        selectMachine(machine.id, true);
      });

      row.appendChild(card);
      els.cardsGrid.appendChild(row);
    }
  }

  function selectMachine(id, openDetailPane = true) {
    const machine = state.allMachines.find(m => m.id === id);
    if (!machine) return;

    state.selectedId = id;
    renderDetail(machine);
    updateSelectedCard();

    if (openDetailPane) {
      els.detailPane.classList.add("open");
      els.mobileOverlay.classList.add("open");
    }
  }

  function closeMobileDetail() {
    els.detailPane.classList.remove("open");
    els.mobileOverlay.classList.remove("open");
  }

  function updateSelectedCard() {
    const cards = els.cardsGrid.querySelectorAll(".card");
    for (const card of cards) {
      card.classList.toggle("selected", card.dataset.id === state.selectedId);
    }
  }

  function buildDetailMarkup(machine, includeHeader = true) {

    const pg = getPriceguideEntry(machine);

    const expenseRows = Array.isArray(machine.expenses) && machine.expenses.length
      ? machine.expenses.map(exp => `
        <div class="expenseRow">
          <span class="label">${escapeHtml(exp.date || "")} ${exp.category ? "• " + escapeHtml(exp.category) : ""}</span>
          <span class="value">${escapeHtml(formatMoney(exp.amount))}</span>
        </div>
        ${exp.note ? `<div class="detailMeta" style="margin: 2px 0 10px;">${escapeHtml(exp.note)}</div>` : ""}
      `).join("")
      : `<div class="detailMeta">No expense entries yet.</div>`;

    const photoStrip = machine.photos && machine.photos.length
      ? `
      <div class="photoStrip">
        ${machine.photos.slice(1).map(photo => `
          <div class="photoThumb">
            <img src="${escapeAttr(getPhotoUrl(photo))}" alt="${escapeAttr(machine.title)}">
          </div>
        `).join("")}
      </div>
    `
      : `<div class="detailMeta">No additional photos.</div>`;

    const totalExpenses = machine.totalExpenses ?? sumExpenses(machine.expenses);
    const totalCost = machine.totalCost ?? addMoney(machine.purchasePrice, totalExpenses);
    const profit = machine.soldPrice != null ? machine.soldPrice - (totalCost || 0) : null;

    const heroImageUrl = getDetailHeroPhotoUrl(machine);

    const pgImage = heroImageUrl
      ? `
    <div class="priceguideHero">
      <img src="${escapeAttr(heroImageUrl)}" alt="${escapeAttr(pg?.title || machine.title)}">
    </div>
  `
      : "";

    const pgVariants = pg && Array.isArray(pg.variant) && pg.variant.length
      ? `
        <div class="detailMeta">
          ${pg.variant.map(v => `
            <div class="detailMetaRow">
              <span class="label">${escapeHtml(v.type || "Variant")}</span>
              <span class="value">${escapeHtml(
        (Number.isFinite(Number(v.price_lower)) || Number.isFinite(Number(v.price_higher)))
          ? `${formatMoney(v.price_lower)} – ${formatMoney(v.price_higher)}`
          : "—"
      )}</span>
            </div>
          `).join("")}
        </div>
      `
      : `<div class="detailMeta">No variant pricing.</div>`;


    return `
    ${includeHeader ? "" : `<div class="detailHeader"><h2 class="detailTitle">${escapeHtml(machine.title)}</h2></div>`}

    <div class="detailContent">

      ${pg ? `
      <section class="detailSection">
        ${pgImage}
        <div class="detailMeta">
          <div class="detailMetaRow"><span class="label">Title</span><span class="value">${escapeHtml(pg.title || "—")}</span></div>
          <div class="detailMetaRow"><span class="label">Maker / date</span><span class="value">${escapeHtml([pg.manufacturer, pg.date].filter(Boolean).join(" – ") || "—")}</span></div>
          <div class="detailMetaRow"><span class="label">Genre</span><span class="value">${escapeHtml(pg.genre || "—")}</span></div>
          <div class="detailMetaRow"><span class="label">Ratings</span><span class="value">${escapeHtml(
      `User ${formatRating(pg.ratings?.user)} • Fun ${formatRating(pg.ratings?.fun)} • Collect ${formatRating(pg.ratings?.collector)}`)}
          </span></div>
          <div class="detailMetaRow"><span class="label">Guide range</span><span class="value">${escapeHtml(formatPriceguideRange(pg))}</span></div>
        </div>
      </section>

      ` : ""}
      
      <section class="detailSection">
        <h3>Notes</h3>
        <div class="detailNotes">${escapeHtml(machine.notes || "No notes yet.")}</div>
      </section>

      <section class="detailSection">
        <h3>Photos</h3>
        ${photoStrip}
      </section>

      <section class="detailSection">
        <h3>Purchase info</h3>
        <div class="detailStats">
          <div class="statRow"><span class="label">Purchase price</span><span class="value">${escapeHtml(formatMoney(machine.purchasePrice))}</span></div>
          <div class="statRow"><span class="label">Total expenses</span><span class="value">${escapeHtml(formatMoney(totalExpenses))}</span></div>
          <div class="statRow"><span class="label">Total cost</span><span class="value">${escapeHtml(formatMoney(totalCost))}</span></div>
        </div>
      </section>

      <section class="detailSection">
        <h3>Expense list</h3>
        <div class="detailList">${expenseRows}</div>
      </section>

      <section class="detailSection">
        <h3>Profit / loss</h3>
        <div class="detailStats">
          <div class="statRow"><span class="label">Sold price</span><span class="value">${escapeHtml(formatMoney(machine.soldPrice))}</span></div>
          <div class="statRow"><span class="label">Profit / loss</span><span class="value">${escapeHtml(formatMoney(profit))}</span></div>
        </div>
      </section>
    </div>
  `;
  }

  function renderDetail(machine) {
    if (!machine) {
      els.detailTitle.textContent = "Select a machine";
      els.detailContent.innerHTML = `<div class="detailPlaceholder">No machine selected.</div>`;
      return;
    }

    els.detailTitle.textContent = machine.title;
    els.detailContent.innerHTML = buildDetailMarkup(machine, true);
  }

  function uniqueSorted(values) {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
  }

  function formatYearManufacturer(machine) {
    const parts = [];
    if (machine.year != null && machine.year !== "") parts.push(String(machine.year));
    if (machine.manufacturer) parts.push(machine.manufacturer);
    return parts.length ? parts.join(" • ") : "—";
  }

  function formatLocationCondition(machine) {
    const parts = [];

    if (machine.location) {
      parts.push(machine.location);
    }

    if (machine.condition) {
      parts.push(machine.condition);
    }

    if (machine.soldDate && String(machine.soldDate).trim() !== "") {
      parts.push("sold");
    }

    return parts.length ? parts.join(" - ") : "—";
  }

  function formatMoney(value) {
    if (value === null || value === undefined || value === "") return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(n);
  }

  function getCardPhotoUrl(machine) {
    if (machine.photo) {
      return getPhotoUrl(machine.photo);
    }

    if (Array.isArray(machine.photos) && machine.photos.length) {
      return getPhotoUrl(machine.photos[0]);
    }

    const pg = getPriceguideEntry(machine);
    if (pg && pg.image) {
      return getPriceguideImageUrl(pg.image);
    }

    return getPhotoUrl("");
  }

  function getDetailHeroPhotoUrl(machine) {
    if (machine.photo) {
      return getPhotoUrl(machine.photo);
    }

    const pg = getPriceguideEntry(machine);
    if (pg && pg.image) {
      return getPriceguideImageUrl(pg.image);
    }

    if (Array.isArray(machine.photos) && machine.photos.length) {
      return getPhotoUrl(machine.photos[0]);
    }

    return getPhotoUrl("");
  }


  function normalizeImgBB(url) {
    if (!url) return url;

    // Only direct image URLs are usable in <img src="">
    if (url.includes("i.ibb.co")) return url;

    // Leave ibb.co page links alone so we do not invent a bad image URL
    return url;
  }

  function getPhotoUrl(filename) {
    if (!filename) return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
      <rect width="640" height="480" fill="#111"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#777" font-family="Arial" font-size="28">
        No Photo
      </text>
    </svg>`
    );

    filename = normalizeImgBB(filename);

    if (/^https?:\/\//i.test(filename) || filename.startsWith("images/")) {
      return filename;
    }

    return `images/${filename}`;
  }

  function sumExpenses(expenses) {
    if (!Array.isArray(expenses)) return null;
    return expenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
  }

  function addMoney(a, b) {
    const n1 = Number(a);
    const n2 = Number(b);
    if (!Number.isFinite(n1) && !Number.isFinite(n2)) return null;
    return (Number.isFinite(n1) ? n1 : 0) + (Number.isFinite(n2) ? n2 : 0);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }
})();