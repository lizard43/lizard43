(() => {

  const VERSION = 'v20260314';

  const API_URL = 'https://script.google.com/macros/s/AKfycbyfpebveJYArafZ2FaMWNTT5IYrkwdc56vOyGA8CrStTu1dXiqvIanfS_YQtMJdVu53kA/exec';

  const state = {
    allMachines: [],
    filteredMachines: [],
    selectedId: null,
    priceguideEntries: [],
    priceguideByTitle: new Map(),
    priceguideById: new Map(),
    detailHistoryOpen: false,
    auth: {
      username: "",
      loggedIn: false
    },
    settingsOpen: false,
    editingId: null,
    expenseLoadConcurrency: 4,
    noteLoadConcurrency: 4
  };

  const els = {
    searchInput: document.getElementById("searchInput"),
    locationFilter: document.getElementById("locationFilter"),
    conditionFilter: document.getElementById("conditionFilter"),
    settingsBtn: document.getElementById("settingsBtn"),
    settingsModal: document.getElementById("settingsModal"),
    settingsOverlay: document.getElementById("settingsOverlay"),
    settingsVersion: document.getElementById("settingsVersion"),
    settingsUsernameRow: document.getElementById("settingsUsernameRow"),
    settingsAuthActions: document.getElementById("settingsAuthActions"),
    settingsUsernameInput: document.getElementById("settingsUsernameInput"),
    settingsLoginBtn: document.getElementById("settingsLoginBtn"),
    settingsSaveBtn: document.getElementById("settingsSaveBtn"),
    settingsCancelBtn: document.getElementById("settingsCancelBtn"),
    settingsCloseBtn: document.getElementById("settingsCloseBtn"),
    editOverlay: document.getElementById("editOverlay"),
    editModal: document.getElementById("editModal"),
    editForm: document.getElementById("editForm"),
    editGameId: document.getElementById("editGameId"),
    editTitle: document.getElementById("editTitle"),
    editLocation: document.getElementById("editLocation"),
    editCondition: document.getElementById("editCondition"),
    editPgId: document.getElementById("editPgId"),
    editPhoto: document.getElementById("editPhoto"),
    editNotes: document.getElementById("editNotes"),
    editPurchaseDate: document.getElementById("editPurchaseDate"),
    editPurchasePrice: document.getElementById("editPurchasePrice"),
    editPurchaseFrom: document.getElementById("editPurchaseFrom"),
    editSoldDate: document.getElementById("editSoldDate"),
    editSoldPrice: document.getElementById("editSoldPrice"),
    editSoldTo: document.getElementById("editSoldTo"),
    editSaveBtn: document.getElementById("editSaveBtn"),
    editCancelBtn: document.getElementById("editCancelBtn"),
    editCloseBtn: document.getElementById("editCloseBtn"),
    cardsGrid: document.getElementById("cardsGrid"),
    emptyState: document.getElementById("emptyState"),
    detailPane: document.getElementById("detailPane"),
    detailTitle: document.getElementById("detailTitle"),
    detailContent: document.getElementById("detailContent"),
    closeDetailBtn: document.getElementById("closeDetailBtn"),
    mobileOverlay: document.getElementById("mobileOverlay")
  };

  function formatApiDate(value) {
    if (!value) return "";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    return new Intl.DateTimeFormat("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric"
    }).format(d);
  }


  async function preloadNotesForMachinesInBackground(machines, concurrency = state.noteLoadConcurrency) {
    const queue = machines.filter(machine => machine?.id);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < queue.length) {
        const currentIndex = nextIndex++;
        const machine = queue[currentIndex];
        await hydrateMachineNotes(machine);
        patchMachineUI(machine);
      }
    }

    const workerCount = Math.max(1, Math.min(concurrency, queue.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  async function hydrateMachineNotes(machine) {
    if (!machine?.id) return;

    try {
      machine.apiNotes = await loadNotesForGame(machine.id);
    } catch (err) {
      console.warn(`Could not load notes for ${machine.id}: ${err.message}`);
      machine.apiNotes = [];
    }
  }

  async function loadNotesForGame(gameID) {
    if (!gameID) return [];

    const payload = await apiGet({
      resource: "notes",
      gameID
    });

    if (!payload || payload.ok !== true || !Array.isArray(payload.data)) {
      throw new Error("Notes API returned invalid data.");
    }

    return payload.data
      .filter(row => String(row.gameID || "").trim() === String(gameID).trim())
      .filter(row => row && (row.noteID !== "" || row.note || row.category || row.date))
      .map(normalizeNote);
  }

  async function preloadExpensesForMachinesInBackground(machines, concurrency = state.expenseLoadConcurrency) {
    const queue = machines.filter(machine => machine?.id);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < queue.length) {
        const currentIndex = nextIndex++;
        const machine = queue[currentIndex];
        await hydrateMachineExpenses(machine);
        patchMachineUI(machine);
      }
    }

    const workerCount = Math.max(1, Math.min(concurrency, queue.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  async function hydrateMachineExpenses(machine) {
    if (!machine?.id) return;

    try {
      const expenses = await loadExpensesForGame(machine.id);
      machine.expenses = expenses;
      machine.totalExpenses = sumExpenses(expenses);
      machine.totalCost = addMoney(machine.purchasePrice, machine.totalExpenses);
    } catch (err) {
      console.warn(`Could not load expenses for ${machine.id}: ${err.message}`);
      machine.expenses = [];
      machine.totalExpenses = 0;
      machine.totalCost = addMoney(machine.purchasePrice, 0);
    }
  }

  async function loadExpensesForGame(gameID) {
    if (!gameID) return [];

    const payload = await apiGet({
      resource: "expenses",
      gameId: gameID
    });

    if (!payload || payload.ok !== true || !Array.isArray(payload.data)) {
      throw new Error("Expenses API returned invalid data.");
    }

    return payload.data
      .filter(row => String(row.gameID || "").trim() === String(gameID).trim())
      .filter(row => row && (row.expenseID !== "" || row.description || row.amount !== ""))
      .map(normalizeExpense);
  }

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

  async function apiPost(action, data) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({ action, data })
    });

    if (!res.ok) {
      throw new Error(`API request failed: HTTP ${res.status}`);
    }

    const payload = await res.json();
    if (!payload || payload.ok !== true) {
      throw new Error(payload?.error || "API request failed.");
    }

    return payload;
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

  function loadAuthState() {
    const savedUsername = localStorage.getItem("arcadesterUsername") || "";
    state.auth.username = savedUsername.trim();
    state.auth.loggedIn = !!state.auth.username;
  }

  function saveAuthState() {
    if (state.auth.loggedIn && state.auth.username) {
      localStorage.setItem("arcadesterUsername", state.auth.username);
    } else {
      localStorage.removeItem("arcadesterUsername");
    }
  }

  function reloadForAuthStateChange() {
    window.location.reload();
  }

  function loginWithUsername() {
    const username = String(els.settingsUsernameInput?.value || "").trim();
    if (!username) {
      els.settingsUsernameInput?.focus();
      return;
    }

    state.auth.username = username;
    state.auth.loggedIn = true;
    saveAuthState();
    reloadForAuthStateChange();
  }

  function logoutUser() {
    state.auth.username = "";
    state.auth.loggedIn = false;
    localStorage.removeItem("arcadesterUsername");
    reloadForAuthStateChange();
  }

  function renderSettingsModal() {
    if (!els.settingsVersion || !els.settingsUsernameRow || !els.settingsAuthActions) return;

    els.settingsVersion.textContent = VERSION;

    if (state.auth.loggedIn) {
      els.settingsUsernameRow.innerHTML = `
        <label class="settingsLabel">Username</label>
        <div class="settingsLoggedInValue">${escapeHtml(state.auth.username)}</div>
      `;

      els.settingsAuthActions.innerHTML = `
        <button id="settingsLogoutBtn" class="settingsActionBtn settingsLogoutBtn" type="button">Logout</button>
      `;

      const logoutBtn = document.getElementById("settingsLogoutBtn");
      logoutBtn?.addEventListener("click", logoutUser);
    } else {
      els.settingsUsernameRow.innerHTML = `
        <label class="settingsLabel" for="settingsUsernameInput">Username</label>
        <div class="settingsInputRow">
          <input id="settingsUsernameInput" class="settingsInput" type="text" autocomplete="username" placeholder="Enter username" value="${escapeAttr(state.auth.username || "")}">
          <button id="settingsLoginBtn" class="settingsActionBtn" type="button">Login</button>
        </div>
      `;

      els.settingsAuthActions.innerHTML = "";

      const usernameInput = document.getElementById("settingsUsernameInput");
      const loginBtn = document.getElementById("settingsLoginBtn");

      if (usernameInput) {
        els.settingsUsernameInput = usernameInput;
        usernameInput.addEventListener("keydown", event => {
          if (event.key === "Enter") {
            event.preventDefault();
            loginWithUsername();
          }
        });
      }

      loginBtn?.addEventListener("click", loginWithUsername);
    }
  }

  function openSettingsModal() {
    state.settingsOpen = true;
    renderSettingsModal();
    els.settingsModal?.classList.add("open");
    els.settingsOverlay?.classList.add("open");
  }

  function closeSettingsModal() {
    state.settingsOpen = false;
    els.settingsModal?.classList.remove("open");
    els.settingsOverlay?.classList.remove("open");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function toDateInputValue(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      const raw = String(value).trim();
      const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function toFormNumberValue(value) {
    return value === null || value === undefined || value === "" ? "" : String(value);
  }

  function getMachineById(id) {
    return state.allMachines.find(m => m.id === id) || null;
  }

  function openEditModal(id) {
    if (!state.auth.loggedIn) return;

    const machine = getMachineById(id);
    if (!machine || !els.editModal) return;

    state.editingId = id;
    els.editGameId.textContent = machine.id || "—";
    els.editTitle.value = machine.title || "";
    els.editLocation.value = machine.location || "";
    els.editCondition.value = machine.condition || "";
    els.editPgId.value = machine.pgID || "";
    els.editPhoto.value = machine.photo || "";
    els.editNotes.value = machine.notes || "";
    els.editPurchaseDate.value = toDateInputValue(machine.purchaseDate);
    els.editPurchasePrice.value = toFormNumberValue(machine.purchasePrice);
    els.editPurchaseFrom.value = machine.purchaseFrom || "";
    els.editSoldDate.value = toDateInputValue(machine.soldDate);
    els.editSoldPrice.value = toFormNumberValue(machine.soldPrice);
    els.editSoldTo.value = machine.soldTo || "";

    els.editOverlay?.classList.add("open");
    els.editModal.classList.add("open");
    els.editTitle?.focus();
  }

  function closeEditModal() {
    state.editingId = null;
    els.editModal?.classList.remove("open");
    els.editOverlay?.classList.remove("open");
    els.editForm?.reset();
  }

  function buildGamePayloadFromForm(id) {
    return {
      ID: id,
      title: String(els.editTitle?.value || "").trim(),
      location: String(els.editLocation?.value || "").trim(),
      condition: String(els.editCondition?.value || "").trim(),
      pgID: String(els.editPgId?.value || "").trim(),
      photo: String(els.editPhoto?.value || "").trim(),
      notes: String(els.editNotes?.value || "").trim(),
      purchaseDate: String(els.editPurchaseDate?.value || "").trim(),
      purchasePrice: String(els.editPurchasePrice?.value || "").trim(),
      purchaseFrom: String(els.editPurchaseFrom?.value || "").trim(),
      soldDate: String(els.editSoldDate?.value || "").trim(),
      soldPrice: String(els.editSoldPrice?.value || "").trim(),
      soldTo: String(els.editSoldTo?.value || "").trim()
    };
  }

  function mergeMachineFromApiRow(existing, row) {
    const merged = normalizeMachine({ ...existing, ...row, id: row.ID || existing.id });
    merged.expenses = existing.expenses;
    merged.totalExpenses = existing.totalExpenses;
    merged.totalCost = addMoney(merged.purchasePrice, merged.totalExpenses);
    merged.apiNotes = existing.apiNotes;
    merged.photos = Array.isArray(existing.photos) ? [...existing.photos] : [];
    return merged;
  }

  async function handleEditFormSubmit(event) {
    event.preventDefault();

    const id = state.editingId;
    const machine = getMachineById(id);
    if (!id || !machine) return;

    const saveBtn = els.editSaveBtn;
    const originalLabel = saveBtn?.textContent || "Save";

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
      }

      const payload = buildGamePayloadFromForm(id);
      const result = await apiPost("updateGame", payload);
      const updated = mergeMachineFromApiRow(machine, result.data || payload);
      const index = state.allMachines.findIndex(item => item.id === id);
      if (index >= 0) {
        state.allMachines[index] = updated;
      }

      populateFilters();
      applyFilters();

      if (state.selectedId === id) {
        renderDetail(updated);
        updateSelectedCard();
      }

      closeEditModal();
    } catch (err) {
      window.alert(`Could not save game. ${err.message}`);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalLabel;
      }
    }
  }

  function normalizeNote(note) {
    return {
      noteID: String(note.noteID || "").trim(),
      gameID: String(note.gameID || "").trim(),
      date: formatApiDate(note.date),
      category: String(note.category || "").trim(),
      note: String(note.note || "").trim()
    };
  }

  function normalizeExpense(exp) {
    return {
      expenseID: String(exp.expenseID || "").trim(),
      gameID: String(exp.gameID || "").trim(),
      date: formatApiDate(exp.date),
      category: String(exp.category || "").trim(),
      description: String(exp.description || "").trim(),
      vendor: String(exp.vendor || "").trim(),
      amount: toNumberOrNull(exp.amount) ?? 0,
      note: String(exp.note || "").trim()
    };
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
    item.expenses = null;

    item.apiNotes = null;

    item.photo = String(item.photo || "").trim();
    item.photos = [];

    item.referenceUrl = String(pg?.pageUrl || "").trim();
    item.referenceLabel = String(pg?.pageLabel || "").trim();

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
    const sources = [
      {
        key: "vag",
        url: "../priceguide/vag/vagal_norm4.json"
      },
      {
        key: "ps",
        url: "../priceguide/pins/ps_machines_merged.json"
      }
    ];

    state.priceguideEntries = [];
    state.priceguideByTitle = new Map();
    state.priceguideById = new Map();

    for (const source of sources) {
      try {
        const response = await fetch(source.url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        let data = await response.json();

        // Pinside wrapper: { machines: [...] }
        if (source.key === "ps" && Array.isArray(data.machines)) {
          data = data.machines;
        }

        if (!Array.isArray(data)) {
          throw new Error("Priceguide JSON must be an array.");
        }

        for (const rawEntry of data) {
          const entry = normalizePriceguideEntry(rawEntry, source.key);
          if (!entry || !entry.id) continue;

          state.priceguideEntries.push(entry);

          const titleKey = normalizeLookupTitle(entry.title);
          if (titleKey && !state.priceguideByTitle.has(titleKey)) {
            state.priceguideByTitle.set(titleKey, entry);
          }

          if (!state.priceguideById.has(entry.id)) {
            state.priceguideById.set(entry.id, entry);
          }
        }

        console.log(`[priceguide] loaded ${data.length} raw entries from ${source.key}`);
      } catch (err) {
        console.warn(`[priceguide] failed to load ${source.url}: ${err.message}`);
      }
    }

    console.log(`[priceguide] loaded ${state.priceguideEntries.length} normalized entries total`);
  }

  function normalizePriceguideEntry(entry, sourceKey) {
    if (!entry || typeof entry !== "object") return null;

    if (sourceKey === "vag") {
      const id = String(entry.id || "").trim() || `vag-${normalizeLookupTitle(entry.title)}`;

      return {
        source: "vag",
        id,
        title: String(entry.title || "").trim(),
        manufacturer: String(entry.manufacturer || "").trim(),
        date: String(entry.date || "").trim(),
        genre: String(entry.genre || "").trim(),
        image: String(entry.image || "").trim(),
        imageUrl: "",
        pageUrl: String(entry.klov || "").trim(),
        pageLabel: "KLOV",
        ratings: entry.ratings || {},
        guideRange: getVagGuideRange(entry),
        variants: Array.isArray(entry.variant) ? entry.variant : [],
        raw: entry
      };
    }

    if (sourceKey === "ps") {
      const pinsideID = String(entry.pinsideID || "").trim();
      if (!pinsideID) return null;

      return {
        source: "ps",
        id: `ps-${pinsideID}`,
        title: String(entry.name || "").trim(),
        manufacturer: String(entry.manufacturer || "").trim(),
        date: String(entry.date || "").trim(),
        genre: String(entry.type || "").trim(),
        image: "",
        imageUrl: String(entry.imageUrl || "").trim(),
        pageUrl: String(entry.url || "").trim(),
        pageLabel: "Pinside",
        ratings: {
          user: entry.score
        },
        guideRange: getPinsideGuideRange(entry),
        variants: [],
        raw: entry
      };
    }

    return null;
  }

  function getVagGuideRange(entry) {
    if (!entry || !Array.isArray(entry.variant) || entry.variant.length === 0) {
      return null;
    }

    const lows = entry.variant
      .map(v => Number(v.price_lower))
      .filter(Number.isFinite);

    const highs = entry.variant
      .map(v => Number(v.price_higher))
      .filter(Number.isFinite);

    if (!lows.length && !highs.length) return null;

    return {
      low: lows.length ? Math.min(...lows) : null,
      high: highs.length ? Math.max(...highs) : null
    };
  }

  function getPinsideGuideRange(entry) {
    const low = Number(entry.lowvalue);
    const high = Number(entry.highvalue);

    if (!Number.isFinite(low) && !Number.isFinite(high)) return null;

    return {
      low: Number.isFinite(low) ? low : null,
      high: Number.isFinite(high) ? high : null,
      avg: Number.isFinite(Number(entry.avgvalue)) ? Number(entry.avgvalue) : null
    };
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

  function getPriceguideImageUrl(entry) {
    if (!entry) return "";

    if (entry.source === "ps") {
      return entry.imageUrl || "";
    }

    if (entry.source === "vag") {
      if (!entry.image) return "";
      if (/^https?:\/\//i.test(entry.image)) return entry.image;
      return `../priceguide/vag/images/${entry.image}`;
    }

    return "";
  }

  function formatRating(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return String(Number(n.toFixed(2)));
  }

  function formatPriceguideRange(entry) {
    if (!entry || !entry.guideRange) return "—";

    const low = entry.guideRange.low;
    const high = entry.guideRange.high;

    if (low != null && high != null) {
      return `${formatMoney(low)} – ${formatMoney(high)}`;
    }

    return formatMoney(low ?? high);
  }

  function formatMoneyNoCents(value) {
    if (value === null || value === undefined || value === "") return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(n);
  }

  function formatPriceguideRangeNoCents(entry) {
    if (!entry || !entry.guideRange) return "—";

    const low = entry.guideRange.low;
    const high = entry.guideRange.high;

    if (low != null && high != null) {
      return `${formatMoneyNoCents(low)} – ${formatMoneyNoCents(high)}`;
    }

    return formatMoneyNoCents(low ?? high);
  }

  function buildDetailInfoLine(pg) {
    if (!pg) return "—";
    return [pg.manufacturer, pg.date].filter(Boolean).join(" • ") || "—";
  }

  function buildDetailRatingLine(pg) {
    if (!pg) return "—";

    if (pg.source === "ps") {
      return `User Rating ${formatRating(pg.ratings?.user)}`;
    }

    const parts = [];
    const user = formatRating(pg.ratings?.user);
    const collect = formatRating(pg.ratings?.collector);

    if (user !== "—") parts.push(`User Rating ${user}`);
    if (collect !== "—") parts.push(`Collector ${collect}`);

    return parts.length ? parts.join(" • ") : "—";
  }

  async function init() {
    loadAuthState();
    wireEvents();

    try {
      await loadPriceguide();
      state.allMachines = await window.InventoryLoader.load();
      populateFilters();
      applyFilters();
      preloadExpensesForMachinesInBackground(state.allMachines);
      preloadNotesForMachinesInBackground(state.allMachines);

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

    els.settingsBtn.addEventListener("click", openSettingsModal);
    els.settingsCloseBtn.addEventListener("click", closeSettingsModal);
    els.settingsCancelBtn.addEventListener("click", closeSettingsModal);
    els.settingsSaveBtn.addEventListener("click", () => {
      if (state.auth.loggedIn) {
        closeSettingsModal();
        return;
      }
      loginWithUsername();
    });
    els.settingsOverlay.addEventListener("click", closeSettingsModal);

    els.editCloseBtn?.addEventListener("click", closeEditModal);
    els.editCancelBtn?.addEventListener("click", closeEditModal);
    els.editOverlay?.addEventListener("click", closeEditModal);
    els.editForm?.addEventListener("submit", handleEditFormSubmit);

    els.closeDetailBtn.addEventListener("click", closeMobileDetail);
    els.mobileOverlay.addEventListener("click", closeMobileDetail);

    window.addEventListener("resize", updateSelectedCard);

    window.addEventListener("popstate", () => {
      if (els.detailPane.classList.contains("open")) {
        state.detailHistoryOpen = false;
        closeMobileDetail(false);
      }
    });
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

  function createMachineRow(machine) {
    const row = document.createElement("div");
    row.className = "machineRow";
    row.dataset.id = machine.id;

    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = machine.id;

    if (isSoldMachine(machine)) {
      card.classList.add("cardSold");
    }

    if (machine.id === state.selectedId) {
      card.classList.add("selected");
    }

    const cardImageUrl = getCardPhotoUrl(machine);
    const expensesLoading = machine.expenses === null;
    const totalExpenses = machine.totalExpenses ?? sumExpenses(machine.expenses);
    const totalCost = machine.totalCost ?? addMoney(machine.purchasePrice, totalExpenses);
    const isSold = isSoldMachine(machine);
    const profit = machine.soldPrice != null && totalCost != null ? machine.soldPrice - totalCost : null;

    const locationCondition = [machine.location, machine.condition]
      .filter(Boolean)
      .join(" · ");

    const cardNotes = machine.notes || "";

    const soldBlock = isSold
      ? `
          <div class="cardStatRow">
            <span class="cardStatLabel">Sold</span>
            <span class="cardStatValue">${escapeHtml(formatMoney(machine.soldPrice))}</span>
          </div>
          <div class="cardStatRow">
            <span class="cardStatLabel">P/L</span>
            <span class="cardStatValue cardProfit ${profit != null ? (profit >= 0 ? "positive" : "negative") : ""} ${expensesLoading ? "isLoading" : ""}">${escapeHtml(expensesLoading ? "…" : formatMoney(profit))}</span>
          </div>
        `
      : "";

    card.innerHTML = `
      <div class="cardPhotoWrap">
        <img class="cardPhoto" src="${escapeAttr(cardImageUrl)}" alt="${escapeAttr(machine.title)}">
      </div>

      <div class="cardBody">
        <div class="cardTopRow">
          <div class="cardIdLineWrap">
            <div class="cardIdLine">${escapeHtml(machine.id || "—")}</div>
            ${state.auth.loggedIn ? `
              <button class="cardEditBtn" type="button" aria-label="Edit ${escapeAttr(machine.id || machine.title)}" title="Edit game">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.96 1.96 3.75 3.75 2.13-1.79Z"/>
                </svg>
              </button>
            ` : ""}
          </div>
          <button class="detailsBtn" type="button" aria-label="Open details">&raquo;</button>
        </div>

        <div class="cardTitleLine">${escapeHtml(machine.title)}</div>

        <div class="cardMetaLine">
          ${escapeHtml(locationCondition || "—")}
        </div>

        ${cardNotes ? `
          <div class="cardNotesLine">${escapeHtml(cardNotes)}</div>
        ` : ""}

        <div class="cardStats">
          <div class="cardStatRow">
            <span class="cardStatLabel">Purchase</span>
            <span class="cardStatValue">${escapeHtml(formatMoney(machine.purchasePrice))}</span>
          </div>

          <div class="cardStatRow">
            <span class="cardStatLabel">Expenses</span>
            <span class="cardStatValue ${expensesLoading ? "isLoading" : ""}">${escapeHtml(expensesLoading ? "…" : formatMoney(totalExpenses))}</span>
          </div>

          <div class="cardStatRow cardStatRowTotal">
            <span class="cardStatLabel">Investment</span>
            <span class="cardStatValue ${expensesLoading ? "isLoading" : ""}">${escapeHtml(expensesLoading ? "…" : formatMoney(totalCost))}</span>
          </div>

          ${soldBlock}
        </div>
      </div>
    `;

    card.addEventListener("click", event => {
      const clickedKlov = event.target.closest("a");
      const clickedDetails = event.target.closest(".detailsBtn");
      const clickedEdit = event.target.closest(".cardEditBtn");
      if (clickedKlov || clickedDetails || clickedEdit) return;

      selectMachine(machine.id, true);
    });

    const detailsBtn = card.querySelector(".detailsBtn");
    detailsBtn.addEventListener("click", event => {
      event.stopPropagation();
      selectMachine(machine.id, true);
    });

    const editBtn = card.querySelector(".cardEditBtn");
    editBtn?.addEventListener("click", event => {
      event.stopPropagation();
      openEditModal(machine.id);
    });

    row.appendChild(card);
    return row;
  }

  function patchMachineUI(machine) {
    const existingRow = els.cardsGrid.querySelector(`.machineRow[data-id="${CSS.escape(machine.id)}"]`);
    if (existingRow) {
      existingRow.replaceWith(createMachineRow(machine));
    }

    if (state.selectedId === machine.id) {
      renderDetail(machine);
      updateSelectedCard();
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
      els.cardsGrid.appendChild(createMachineRow(machine));
    }
  }

  async function refreshMachineExpenses(machine) {
    await hydrateMachineExpenses(machine);
    patchMachineUI(machine);
  }

  function selectMachine(id, openDetailPane = true) {
    const machine = state.allMachines.find(m => m.id === id);
    if (!machine) return;

    state.selectedId = id;
    updateSelectedCard();

    if (openDetailPane) {
      const wasOpen = els.detailPane.classList.contains("open");

      els.detailPane.classList.add("open");
      els.mobileOverlay.classList.add("open");

      if (!wasOpen) {
        history.pushState({ detailPane: true }, "");
        state.detailHistoryOpen = true;
      }
    }

    renderDetail(machine);
    updateSelectedCard();
  }

  function closeMobileDetail(useHistoryBack = true) {
    const wasOpen = els.detailPane.classList.contains("open");

    els.detailPane.classList.remove("open");
    els.mobileOverlay.classList.remove("open");

    if (useHistoryBack && wasOpen && state.detailHistoryOpen) {
      state.detailHistoryOpen = false;
      history.back();
    }
  }

  function updateSelectedCard() {
    const cards = els.cardsGrid.querySelectorAll(".card");
    for (const card of cards) {
      card.classList.toggle("selected", card.dataset.id === state.selectedId);
    }
  }

  function buildMachineNotesMarkup(machine) {
    const baseNote = String(machine.notes || "").trim();
    const apiNotes = Array.isArray(machine.apiNotes) ? machine.apiNotes : null;

    const parts = [];

    if (baseNote) {
      parts.push(`<div class="detailNoteEntry detailNoteEntryBase">${escapeHtml(baseNote)}</div>`);
    }

    if (apiNotes === null) {
      parts.push(`<div class="detailMeta detailMetaLoading">Loading notes…</div>`);
    } else if (apiNotes.length) {
      parts.push(apiNotes.map(note => `
        <div class="detailNoteEntry detailNoteEntryApi">
          <div class="expenseTop detailNoteMeta">
            ${escapeHtml(note.date || "—")}
            ${note.category ? ` • ${escapeHtml(note.category)}` : ""}
          </div>
          <div class="expenseDescMuted detailNoteTextIndented">${escapeHtml(note.note || "—")}</div>
        </div>
      `).join(""));
    }

    if (!parts.length) {
      return `<div class="detailNotes">No notes yet.</div>`;
    }

    return `<div class="detailNotesList">${parts.join("")}</div>`;
  }

  function buildDetailMarkup(machine, includeHeader = true) {
    const pg = getPriceguideEntry(machine);

    const expensesLoading = machine.expenses === null;
    const totalExpenses = machine.totalExpenses ?? sumExpenses(machine.expenses);
    const totalCost = machine.totalCost ?? addMoney(machine.purchasePrice, totalExpenses);
    const profit = machine.soldPrice != null && totalCost != null ? machine.soldPrice - totalCost : null;

    const expenseRows = expensesLoading
      ? `<div class="detailMeta detailMetaLoading">Loading expenses…</div>`
      : Array.isArray(machine.expenses) && machine.expenses.length
      ? machine.expenses.map(exp => `
        <div class="expenseRow">
          <div class="expenseMain">
            <div class="expenseTop">
              ${escapeHtml(exp.date || "—")}
              ${exp.category ? ` • ${escapeHtml(exp.category)}` : ""}
              ${exp.vendor ? ` • Vendor: ${escapeHtml(exp.vendor)}` : ""}
            </div>
            <div class="expenseDescMuted">
              ${escapeHtml(exp.description || "—")}
            </div>
          </div>
          <div class="expenseAmount">${escapeHtml(formatMoney(exp.amount))}</div>
        </div>
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

    const heroImageUrl = getDetailHeroPhotoUrl(machine);

    const pgImage = heroImageUrl
      ? `
      <div class="priceguideHero">
        <img src="${escapeAttr(heroImageUrl)}" alt="${escapeAttr(pg?.title || machine.title)}">
      </div>
    `
      : "";

    return `
    ${includeHeader ? "" : `<div class="detailHeader"><h2 class="detailTitle">${escapeHtml(machine.title)}</h2></div>`}

    <div class="detailContent">
      ${pg ? `
      <section class="detailSection detailHeroSection">
        ${pgImage}
        <div class="detailHeroInfo">
          <div class="detailHeroLine">${escapeHtml(buildDetailInfoLine(pg))}</div>
          <div class="detailHeroLine">${escapeHtml(buildDetailRatingLine(pg))}</div>
          <div class="detailHeroLine">${escapeHtml(formatPriceguideRangeNoCents(pg))}</div>
          <div class="detailHeroLine">
            ${pg.pageUrl
          ? `Reference: <a href="${escapeAttr(pg.pageUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pg.pageLabel || "Open reference")}</a>`
          : `Reference: —`
        }
          </div>
        </div>
      </section>
      ` : ""}

      <section class="detailSection">
        <h3>Notes</h3>
        ${buildMachineNotesMarkup(machine)}
      </section>

      <section class="detailSection">
        <h3>Photos</h3>
        ${photoStrip}
      </section>

      <section class="detailSection">
        <h3>Expenses</h3>
        <div class="detailList">${expenseRows}</div>

        <div class="detailMoneySummary">
          <div class="moneyRow">
            <span class="moneyLabel">Total Expenses</span>
            <span class="moneyValue ${expensesLoading ? "isLoading" : ""}">${escapeHtml(expensesLoading ? "…" : formatMoney(totalExpenses))}</span>
          </div>

          <div class="moneySpacer"></div>

          <div class="moneyRow">
            <span class="moneyLabel">Purchase Price</span>
            <span class="moneyValue">${escapeHtml(formatMoney(machine.purchasePrice))}</span>
          </div>

          <div class="moneySpacer"></div>

          <div class="moneyRow moneyRowTotal">
            <span class="moneyLabel">Total Investment</span>
            <span class="moneyValue ${expensesLoading ? "isLoading" : ""}">${escapeHtml(expensesLoading ? "…" : formatMoney(totalCost))}</span>
          </div>
        </div>
      </section>

      <section class="detailSection">
        <h3>Profit / loss</h3>
        <div class="detailMoneySummary">
          <div class="moneyRow">
            <span class="moneyLabel">Sold price</span>
            <span class="moneyValue">${escapeHtml(formatMoney(machine.soldPrice))}</span>
          </div>
          <div class="moneyRow moneyRowTotal">
            <span class="moneyLabel">Profit / loss</span>
            <span class="moneyValue ${profit != null ? `moneyProfit ${profit >= 0 ? "positive" : "negative"}` : ""} ${expensesLoading ? "isLoading" : ""}">
              ${escapeHtml(expensesLoading ? "…" : formatMoney(profit))}
            </span>
          </div>
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

    const pg = getPriceguideEntry(machine);
    const pgImageUrl = getPriceguideImageUrl(pg);
    if (pgImageUrl) {
      return pgImageUrl;
    }

    if (Array.isArray(machine.photos) && machine.photos.length) {
      return getPhotoUrl(machine.photos[0]);
    }

    return getPhotoUrl("");
  }

  function getDetailHeroPhotoUrl(machine) {
    const pg = getPriceguideEntry(machine);
    const pgImageUrl = getPriceguideImageUrl(pg);
    if (pgImageUrl) {
      return pgImageUrl;
    }

    if (Array.isArray(machine.photos) && machine.photos.length) {
      return getPhotoUrl(machine.photos[0]);
    }

    if (machine.photo) {
      return getPhotoUrl(machine.photo);
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