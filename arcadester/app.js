(() => {

  const VERSION = 'v20260314';

  const API_URL = 'https://script.google.com/macros/s/AKfycbyfpebveJYArafZ2FaMWNTT5IYrkwdc56vOyGA8CrStTu1dXiqvIanfS_YQtMJdVu53kA/exec';
  const IMGBB_API_KEY = '10002e3b737dac20990ce3adef55b8f9';

  const state = {
    allMachines: [],
    filteredMachines: [],
    selectedId: null,
    priceguideEntries: [],
    priceguideByTitle: new Map(),
    priceguideById: new Map(),
    uiRouteStack: [],
    auth: {
      username: "",
      loggedIn: false,
      error: ""
    },
    settingsOpen: false,
    editingId: null,
    expenseEditingId: null,
    expenseDraftRows: [],
    photoEditingId: null,
    photoDraftRows: [],
    photoViewer: {
      open: false,
      source: null,
      machineId: null,
      rows: [],
      index: 0,
      touchStartX: 0,
      touchStartY: 0
    },
    detailPhotoTouch: {
      machineId: null,
      touchStartX: 0,
      touchStartY: 0
    },
    imagePreloadCache: new Set(),
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
    expenseOverlay: document.getElementById("expenseOverlay"),
    expenseModal: document.getElementById("expenseModal"),
    expenseForm: document.getElementById("expenseForm"),
    expenseGameId: document.getElementById("expenseGameId"),
    expenseRows: document.getElementById("expenseRows"),
    expenseSaveBtn: document.getElementById("expenseSaveBtn"),
    expenseCancelBtn: document.getElementById("expenseCancelBtn"),
    expenseCloseBtn: document.getElementById("expenseCloseBtn"),
    photoOverlay: document.getElementById("photoOverlay"),
    photoModal: document.getElementById("photoModal"),
    photoForm: document.getElementById("photoForm"),
    photoGameId: document.getElementById("photoGameId"),
    photoRows: document.getElementById("photoRows"),
    photoSaveBtn: document.getElementById("photoSaveBtn"),
    photoCancelBtn: document.getElementById("photoCancelBtn"),
    photoCloseBtn: document.getElementById("photoCloseBtn"),
    photoViewerOverlay: document.getElementById("photoViewerOverlay"),
    photoViewerModal: document.getElementById("photoViewerModal"),
    photoViewerBody: document.querySelector("#photoViewerModal .photoViewerBody"),
    photoViewerImage: document.getElementById("photoViewerImage"),
    photoViewerCaption: document.getElementById("photoViewerCaption"),
    photoViewerCloseBtn: document.getElementById("photoViewerCloseBtn"),
    photoViewerPrevBtn: document.getElementById("photoViewerPrevBtn"),
    photoViewerNextBtn: document.getElementById("photoViewerNextBtn"),
    cardsGrid: document.getElementById("cardsGrid"),
    emptyState: document.getElementById("emptyState"),
    detailPane: document.getElementById("detailPane"),
    detailTitle: document.getElementById("detailTitle"),
    detailContent: document.getElementById("detailContent"),
    closeDetailBtn: document.getElementById("closeDetailBtn"),
    mobileOverlay: document.getElementById("mobileOverlay")
  };


  function pushUiRoute(layer) {
    if (!layer) return;
    state.uiRouteStack.push(layer);
    history.pushState({ arcadesterLayer: layer }, "");
  }

  function removeUiRoute(layer) {
    const index = state.uiRouteStack.lastIndexOf(layer);
    if (index >= 0) {
      state.uiRouteStack.splice(index, 1);
    }
  }

  function getTopUiRoute() {
    return state.uiRouteStack.length ? state.uiRouteStack[state.uiRouteStack.length - 1] : null;
  }

  function closeTopUiLayerFromHistory() {
    const topLayer = getTopUiRoute();
    if (!topLayer) return false;

    switch (topLayer) {
      case 'photoViewer':
        closePhotoViewer(false);
        return true;
      case 'photo':
        closePhotoModal(false);
        return true;
      case 'expense':
        closeExpenseModal(false);
        return true;
      case 'edit':
        closeEditModal(false);
        return true;
      case 'settings':
        closeSettingsModal(false);
        return true;
      case 'detail':
        closeMobileDetail(false);
        return true;
      default:
        removeUiRoute(topLayer);
        return false;
    }
  }

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

  function supportsCameraCapture() {
    const hasTouch = window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    const isMobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    return hasTouch || isMobileUA;
  }

  async function openCameraCapture() {
    if (!supportsCameraCapture()) return;
    if (!state.photoEditingId) return;

    const cameraBtn = document.getElementById("photoCameraBtn");
    if (cameraBtn?.disabled) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "0";

    input.addEventListener("change", async event => {
      try {
        await handleCameraInputChange(event);
      } finally {
        window.setTimeout(() => input.remove(), 0);
      }
    }, { once: true });

    document.body.appendChild(input);
    input.click();
  }

  async function handleCameraInputChange(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    if (!file.type || !file.type.startsWith("image/")) {
      window.alert("Please choose an image file.");
      return;
    }

    const cameraBtn = document.getElementById("photoCameraBtn");
    const originalLabel = cameraBtn?.querySelector("span")?.textContent || "Camera";

    try {
      if (cameraBtn) {
        cameraBtn.disabled = true;
        const label = cameraBtn.querySelector("span");
        if (label) {
          label.textContent = "Uploading…";
        } else {
          cameraBtn.textContent = "Uploading…";
        }
      }

      await addPhotoFromFile(file);
    } catch (err) {
      window.alert(`Could not upload photo. ${err.message}`);
    } finally {
      if (cameraBtn) {
        cameraBtn.disabled = false;
        const label = cameraBtn.querySelector("span");
        if (label) {
          label.textContent = originalLabel;
        } else {
          cameraBtn.textContent = originalLabel;
        }
      }
    }
  }

  async function loadPhotosForGame(gameID) {

    if (!gameID) return [];

    const payload = await apiGet({
      resource: "photos",
      gameID
    });

    if (!payload || payload.ok !== true || !Array.isArray(payload.data)) {
      throw new Error("Photos API returned invalid data.");
    }

    return payload.data
      .filter(row => String(row.gameID || "").trim() === String(gameID).trim())
      .filter(row => row && (row.photoID !== "" || row.url))
      .map(normalizePhoto)
      .sort((a, b) => Number(a.photoID || 0) - Number(b.photoID || 0) || String(a.photoID || "").localeCompare(String(b.photoID || "")));
  }

  async function hydrateMachinePhotos(machine, options = {}) {
    if (!machine?.id) return [];

    const force = options.force === true;

    if (!force && machine.photoStatus === "loaded" && Array.isArray(machine.photos)) {
      return machine.photos;
    }

    if (!force && machine.photoStatus === "loading" && machine.photoPromise) {
      return machine.photoPromise;
    }

    machine.photoStatus = "loading";
    machine.photoPromise = loadPhotosForGame(machine.id)
      .then(photos => {
        machine.photos = photos;
        machine.photoStatus = "loaded";
        const maxIndex = Math.max(0, photos.length - 1);
        machine.photoCarouselIndex = Math.max(0, Math.min(Number(machine.photoCarouselIndex || 0), maxIndex));
        deferPhotoPreload(machine, machine.photoCarouselIndex || 0);
        return photos;
      })
      .catch(err => {
        machine.photos = [];
        machine.photoStatus = "error";
        throw err;
      })
      .finally(() => {
        machine.photoPromise = null;
      });

    return machine.photoPromise;
  }

  function queuePhotoLoadForMachine(machine) {
    if (!machine?.id) return;
    if (machine.photoStatus === "loading" || machine.photoStatus === "loaded") return;

    hydrateMachinePhotos(machine)
      .then(() => patchMachineUI(machine))
      .catch(() => patchMachineUI(machine));
  }

  async function refreshMachinePhotos(machine) {
    await hydrateMachinePhotos(machine, { force: true });
    patchMachineUI(machine);
  }

  function preloadImageUrl(url) {
    const normalizedUrl = String(getPhotoUrl(url) || '').trim();
    if (!normalizedUrl || state.imagePreloadCache.has(normalizedUrl)) return;

    state.imagePreloadCache.add(normalizedUrl);

    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = normalizedUrl;
    if (typeof img.decode === 'function') {
      img.decode().catch(() => { });
    }
  }

  function preloadMachinePhotoWindow(machine, centerIndex = 0) {
    const photos = Array.isArray(machine?.photos) ? machine.photos : [];
    if (!photos.length) return;

    const safeIndex = Math.max(0, Math.min(Number(centerIndex || 0), photos.length - 1));
    const indexes = [safeIndex, safeIndex + 1, safeIndex - 1, safeIndex + 2].filter(index => index >= 0 && index < photos.length);

    indexes.forEach(index => {
      preloadImageUrl(photos[index]?.url);
    });
  }

  function deferPhotoPreload(machine, centerIndex = 0) {
    const run = () => preloadMachinePhotoWindow(machine, centerIndex);
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 800 });
    } else {
      window.setTimeout(run, 60);
    }
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
    state.auth.error = "";
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

  async function loginWithUsername() {
    const username = String(els.settingsUsernameInput?.value || "").trim();
    if (!username) {
      state.auth.error = "Enter a username.";
      renderSettingsModal();
      els.settingsUsernameInput?.focus();
      return;
    }

    const loginBtn = document.getElementById("settingsLoginBtn");
    const saveBtn = els.settingsSaveBtn;
    const originalLoginLabel = loginBtn?.textContent || "Login";
    const originalSaveLabel = saveBtn?.textContent || "Save";

    try {
      state.auth.error = "";
      if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = "Checking…";
      }
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Checking…";
      }

      const payload = await apiGet({ resource: "users" });
      if (!payload || payload.ok !== true || !Array.isArray(payload.data)) {
        throw new Error("Users API returned invalid data.");
      }

      const normalizedUsername = username.toLowerCase();
      const isAllowed = payload.data.some(row => String(row?.name || "").trim().toLowerCase() === normalizedUsername);

      if (!isAllowed) {
        state.auth.username = "";
        state.auth.loggedIn = false;
        state.auth.error = "User not found.";
        localStorage.removeItem("arcadesterUsername");
        renderSettingsModal();
        els.settingsUsernameInput?.focus();
        els.settingsUsernameInput?.select?.();
        return;
      }

      state.auth.username = username;
      state.auth.loggedIn = true;
      state.auth.error = "";
      saveAuthState();
      reloadForAuthStateChange();
    } catch (err) {
      state.auth.username = "";
      state.auth.loggedIn = false;
      state.auth.error = `Login failed. ${err.message}`;
      localStorage.removeItem("arcadesterUsername");
      renderSettingsModal();
      els.settingsUsernameInput?.focus();
      els.settingsUsernameInput?.select?.();
    } finally {
      const refreshedLoginBtn = document.getElementById("settingsLoginBtn");
      if (refreshedLoginBtn) {
        refreshedLoginBtn.disabled = false;
        refreshedLoginBtn.textContent = originalLoginLabel;
      }
      if (els.settingsSaveBtn) {
        els.settingsSaveBtn.disabled = false;
        els.settingsSaveBtn.textContent = originalSaveLabel;
      }
    }
  }

  function logoutUser() {
    state.auth.username = "";
    state.auth.loggedIn = false;
    state.auth.error = "";
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
        ${state.auth.error ? `<div class="settingsError">${escapeHtml(state.auth.error)}</div>` : ""}
      `;

      els.settingsAuthActions.innerHTML = "";

      const usernameInput = document.getElementById("settingsUsernameInput");
      const loginBtn = document.getElementById("settingsLoginBtn");

      if (usernameInput) {
        els.settingsUsernameInput = usernameInput;
        usernameInput.addEventListener("input", () => {
          if (state.auth.error) {
            state.auth.error = "";
            const errorEl = els.settingsUsernameRow?.querySelector(".settingsError");
            errorEl?.remove();
          }
        });
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
    const wasOpen = state.settingsOpen;
    state.settingsOpen = true;
    renderSettingsModal();
    els.settingsModal?.classList.add("open");
    els.settingsOverlay?.classList.add("open");
    if (!wasOpen) {
      pushUiRoute('settings');
    }
  }

  function closeSettingsModal(useHistoryBack = true) {
    const wasOpen = state.settingsOpen;
    state.settingsOpen = false;
    els.settingsModal?.classList.remove("open");
    els.settingsOverlay?.classList.remove("open");
    if (useHistoryBack && wasOpen) {
      history.back();
      return;
    }
    removeUiRoute('settings');
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

  function toApiDateValue(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).trim();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getSortableDateValue(value) {
    if (!value) return 0;

    const isoValue = toApiDateValue(value);
    const d = new Date(isoValue);
    if (!Number.isNaN(d.getTime())) {
      return d.getTime();
    }

    return 0;
  }

  function sortExpensesByDateDesc(expenses) {
    if (!Array.isArray(expenses)) return [];

    return [...expenses].sort((a, b) => {
      const diff = getSortableDateValue(b?.date) - getSortableDateValue(a?.date);
      if (diff !== 0) return diff;
      return String(b?.expenseID || "").localeCompare(String(a?.expenseID || ""));
    });
  }

  function makeLocalExpenseRow(gameID) {
    return {
      expenseID: "",
      gameID: String(gameID || "").trim(),
      date: "",
      category: "",
      description: "",
      vendor: "",
      amount: "",
      note: "",
      _delete: false,
      _dirty: false,
      _originalFingerprint: ""
    };
  }

  function cloneExpenseForDraft(expense) {
    const row = {
      expenseID: String(expense?.expenseID || "").trim(),
      gameID: String(expense?.gameID || "").trim(),
      date: toApiDateValue(expense?.date),
      category: String(expense?.category || "").trim(),
      description: String(expense?.description || "").trim(),
      vendor: String(expense?.vendor || "").trim(),
      amount: expense?.amount === null || expense?.amount === undefined || expense?.amount === "" ? "" : String(expense.amount),
      note: String(expense?.note || "").trim(),
      _delete: false,
      _dirty: false,
      _originalFingerprint: ""
    };

    return markExpenseDraftClean(row);
  }

  function getComparableExpenseDraft(row) {
    return {
      expenseID: String(row?.expenseID || "").trim(),
      gameID: String(row?.gameID || "").trim(),
      date: String(row?.date || "").trim(),
      category: String(row?.category || "").trim(),
      description: String(row?.description || "").trim(),
      vendor: String(row?.vendor || "").trim(),
      amount: String(row?.amount || "").trim(),
      note: String(row?.note || "").trim()
    };
  }

  function expenseDraftFingerprint(row) {
    return JSON.stringify(getComparableExpenseDraft(row));
  }

  function markExpenseDraftClean(row) {
    const fingerprint = expenseDraftFingerprint(row);
    row._originalFingerprint = fingerprint;
    row._dirty = false;
    return row;
  }

  function refreshExpenseDraftDirty(row) {
    row._dirty = expenseDraftFingerprint(row) !== String(row._originalFingerprint || "");
    return row._dirty;
  }

  function getExpenseMachineById(id) {
    return state.allMachines.find(m => m.id === id) || null;
  }

  function renderExpenseEditorRows() {
    if (!els.expenseRows) return;

    const rows = state.expenseDraftRows;
    els.expenseRows.innerHTML = `
      <button class="expenseAddBtn expenseAddBtnTop" type="button" id="expenseAddBtn" aria-label="Add expense row" title="Add expense">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>
        </svg>
        <span>Add expense</span>
      </button>
    ` + rows.map((row, index) => `
      <div class="expenseEditorRow ${row._delete ? "expenseEditorRowDeleted" : ""}" data-index="${index}">
        <div class="expenseEditorRowHeader">
          <div class="expenseEditorRowTitle">Expense ${index + 1}</div>
          <button class="expenseIconBtn expenseDeleteBtn" type="button" data-action="delete" data-index="${index}" aria-label="Delete expense row" title="Delete expense">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v8h-2V9Zm4 0h2v8h-2V9ZM7 9h2v8H7V9Zm-1 12h12a2 2 0 0 0 2-2V7H4v12a2 2 0 0 0 2 2Z"/>
            </svg>
          </button>
        </div>

        <div class="editFieldGrid expenseEditorGrid">
          <div class="editField">
            <label class="settingsLabel" for="expenseDate_${index}">Date</label>
            <input id="expenseDate_${index}" class="settingsInput expenseDraftInput" data-field="date" data-index="${index}" type="date" value="${escapeAttr(row.date || "")}" ${row._delete ? "disabled" : ""}>
          </div>
          <div class="editField">
            <label class="settingsLabel" for="expenseAmount_${index}">Amount</label>
            <input id="expenseAmount_${index}" class="settingsInput expenseDraftInput" data-field="amount" data-index="${index}" type="number" step="0.01" value="${escapeAttr(row.amount || "")}" ${row._delete ? "disabled" : ""}>
          </div>
        </div>

        <div class="editFieldGrid expenseEditorGrid">
          <div class="editField">
            <label class="settingsLabel" for="expenseCategory_${index}">Category</label>
            <input id="expenseCategory_${index}" class="settingsInput expenseDraftInput" data-field="category" data-index="${index}" type="text" value="${escapeAttr(row.category || "")}" ${row._delete ? "disabled" : ""}>
          </div>
          <div class="editField">
            <label class="settingsLabel" for="expenseVendor_${index}">Vendor</label>
            <input id="expenseVendor_${index}" class="settingsInput expenseDraftInput" data-field="vendor" data-index="${index}" type="text" value="${escapeAttr(row.vendor || "")}" ${row._delete ? "disabled" : ""}>
          </div>
        </div>

        <div class="editField">
          <label class="settingsLabel" for="expenseDescription_${index}">Description</label>
          <input id="expenseDescription_${index}" class="settingsInput expenseDraftInput" data-field="description" data-index="${index}" type="text" value="${escapeAttr(row.description || "")}" ${row._delete ? "disabled" : ""}>
        </div>

        <div class="editField">
          <label class="settingsLabel" for="expenseNote_${index}">Note</label>
          <textarea id="expenseNote_${index}" class="settingsInput editTextarea expenseDraftInput" data-field="note" data-index="${index}" ${row._delete ? "disabled" : ""}>${escapeHtml(row.note || "")}</textarea>
        </div>

        ${row._delete ? '<div class="expenseDeletedLabel">Will be deleted on save</div>' : ''}
      </div>
    `).join("");

    els.expenseRows.querySelectorAll('.expenseDraftInput').forEach(input => {
      input.addEventListener('input', handleExpenseDraftInput);
    });

    els.expenseRows.querySelectorAll('.expenseDeleteBtn').forEach(btn => {
      btn.addEventListener('click', handleExpenseDraftDelete);
    });

    document.getElementById('expenseAddBtn')?.addEventListener('click', handleExpenseDraftAdd);
  }

  async function openExpenseModal(id) {
    if (!state.auth.loggedIn) return;

    const machine = getExpenseMachineById(id);
    if (!machine || !els.expenseModal) return;

    state.expenseEditingId = id;

    if (!Array.isArray(machine.expenses)) {
      try {
        await hydrateMachineExpenses(machine);
      } catch (err) {
        window.alert(`Could not load expenses. ${err.message}`);
        return;
      }
    }

    state.expenseDraftRows = Array.isArray(machine.expenses)
      ? sortExpensesByDateDesc(machine.expenses).map(cloneExpenseForDraft)
      : [];

    els.expenseGameId.textContent = machine.id || "—";
    renderExpenseEditorRows();

    const wasOpen = els.expenseModal.classList.contains('open');
    els.expenseOverlay?.classList.add('open');
    els.expenseModal.classList.add('open');
    if (!wasOpen) {
      pushUiRoute('expense');
    }

    els.expenseRows?.querySelector('input, textarea')?.focus();
  }

  function closeExpenseModal(useHistoryBack = true) {
    const wasOpen = els.expenseModal?.classList.contains('open');
    state.expenseEditingId = null;
    state.expenseDraftRows = [];
    els.expenseModal?.classList.remove('open');
    els.expenseOverlay?.classList.remove('open');
    els.expenseForm?.reset();
    if (els.expenseRows) {
      els.expenseRows.innerHTML = '';
    }
    if (useHistoryBack && wasOpen) {
      history.back();
      return;
    }
    removeUiRoute('expense');
  }

  function handleExpenseDraftInput(event) {
    const field = event.target?.dataset?.field;
    const index = Number(event.target?.dataset?.index);
    if (!field || !Number.isInteger(index) || !state.expenseDraftRows[index]) return;

    const row = state.expenseDraftRows[index];
    row[field] = event.target.value;
    refreshExpenseDraftDirty(row);
  }

  function handleExpenseDraftDelete(event) {
    const index = Number(event.currentTarget?.dataset?.index);
    if (!Number.isInteger(index) || !state.expenseDraftRows[index]) return;

    const row = state.expenseDraftRows[index];

    if (row.expenseID) {
      row._delete = !row._delete;
      row._dirty = true;
    } else {
      state.expenseDraftRows.splice(index, 1);
    }

    renderExpenseEditorRows();
  }

  function handleExpenseDraftAdd() {
    state.expenseDraftRows.push(makeLocalExpenseRow(state.expenseEditingId));
    renderExpenseEditorRows();
    const lastIndex = state.expenseDraftRows.length - 1;
    document.getElementById(`expenseDate_${lastIndex}`)?.focus();
  }

  function buildExpensePayloadFromDraft(row) {
    return {
      expenseID: String(row.expenseID || '').trim(),
      gameID: String(row.gameID || state.expenseEditingId || '').trim(),
      date: String(row.date || '').trim(),
      category: String(row.category || '').trim(),
      description: String(row.description || '').trim(),
      vendor: String(row.vendor || '').trim(),
      amount: String(row.amount || '').trim(),
      note: String(row.note || '').trim()
    };
  }

  function isExpenseDraftMeaningful(row) {
    return !!(String(row.date || '').trim() || String(row.category || '').trim() || String(row.description || '').trim() || String(row.vendor || '').trim() || String(row.amount || '').trim() || String(row.note || '').trim());
  }

  async function handleExpenseFormSubmit(event) {
    event.preventDefault();

    const id = state.expenseEditingId;
    const machine = getExpenseMachineById(id);
    if (!id || !machine) return;

    const saveBtn = els.expenseSaveBtn;
    const originalLabel = saveBtn?.textContent || 'Save';

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
      }

      for (const row of state.expenseDraftRows) {
        if (row._delete && row.expenseID) {
          await apiPost('deleteExpense', { expenseID: row.expenseID });
          continue;
        }

        if (row._delete) continue;
        if (!isExpenseDraftMeaningful(row)) continue;

        const payload = buildExpensePayloadFromDraft(row);

        if (payload.expenseID) {
          if (!row._dirty) continue;
          await apiPost('updateExpense', payload);
        } else {
          await apiPost('createExpense', payload);
        }
      }

      await refreshMachineExpenses(machine);

      state.expenseDraftRows = Array.isArray(machine.expenses)
        ? sortExpensesByDateDesc(machine.expenses).map(cloneExpenseForDraft)
        : [];

      closeExpenseModal();
    } catch (err) {
      window.alert(`Could not save expenses. ${err.message}`);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalLabel;
      }
    }
  }


  function normalizePhoto(photo) {
    return {
      photoID: String(photo.photoID || "").trim(),
      gameID: String(photo.gameID || "").trim(),
      url: String(photo.url || "").trim()
    };
  }

  function clonePhotoForDraft(photo) {
    const row = {
      photoID: String(photo?.photoID || "").trim(),
      gameID: String(photo?.gameID || "").trim(),
      url: String(photo?.url || "").trim(),
      _delete: false,
      _dirty: false,
      _originalFingerprint: ""
    };

    return markPhotoDraftClean(row);
  }

  function makeLocalPhotoRow(gameID) {
    return {
      photoID: "",
      gameID: String(gameID || "").trim(),
      url: "",
      _delete: false,
      _dirty: true,
      _originalFingerprint: ""
    };
  }

  function getComparablePhotoDraft(row) {
    return {
      photoID: String(row?.photoID || "").trim(),
      gameID: String(row?.gameID || "").trim(),
      url: String(row?.url || "").trim()
    };
  }

  function photoDraftFingerprint(row) {
    return JSON.stringify(getComparablePhotoDraft(row));
  }

  function markPhotoDraftClean(row) {
    const fingerprint = photoDraftFingerprint(row);
    row._originalFingerprint = fingerprint;
    row._dirty = false;
    return row;
  }

  function refreshPhotoDraftDirty(row) {
    row._dirty = photoDraftFingerprint(row) !== String(row._originalFingerprint || "");
    return row._dirty;
  }

  async function uploadPhotoToImgBB(file) {
    if (!file) throw new Error('No file provided.');

    const formData = new FormData();
    formData.append('image', file);
    formData.append('name', file.name || `arcadester_${Date.now()}`);

    const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(IMGBB_API_KEY)}`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      throw new Error(`ImgBB upload failed: HTTP ${res.status}`);
    }

    const payload = await res.json();
    if (!payload?.success || !payload?.data?.url) {
      throw new Error(payload?.error?.message || 'ImgBB upload failed.');
    }

    return String(payload.data.url).trim();
  }

  function setPhotoDraftUploading(index, isUploading) {
    const row = state.photoDraftRows[index];
    if (!row) return;
    row._uploading = !!isUploading;

    const rowEl = els.photoRows?.querySelector(`.expenseEditorRow[data-index="${index}"]`);
    if (!rowEl) return;
    rowEl.classList.toggle('photoEditorRowUploading', !!isUploading);

    rowEl.querySelectorAll('input, button').forEach(control => {
      if (control.id === 'photoCancelBtn' || control.id === 'photoSaveBtn') return;
      if (control.classList.contains('photoDeleteBtn') || control.classList.contains('photoEditorThumbBtn') || control.classList.contains('photoDraftInput')) {
        control.disabled = !!isUploading || row._delete;
      }
    });

    const statusEl = rowEl.querySelector('.photoUploadStatus');
    if (statusEl) {
      statusEl.textContent = isUploading ? 'Uploading…' : '';
    }
  }

  async function persistNewPhotoDraftRow(row) {
    if (!row || row.photoID || !String(row.gameID || state.photoEditingId || '').trim() || !String(row.url || '').trim()) {
      return row;
    }

    const payload = buildPhotoPayloadFromDraft(row);
    const result = await apiPost('createPhoto', payload);
    const saved = normalizePhoto(result?.data || payload);

    row.photoID = saved.photoID;
    row.gameID = saved.gameID || row.gameID;
    row.url = saved.url || row.url;
    markPhotoDraftClean(row);
    return row;
  }

  async function handlePhotoDrop(event) {
    event.preventDefault();
    const index = Number(event.currentTarget?.dataset?.index);
    if (!Number.isInteger(index) || !state.photoDraftRows[index]) return;

    event.currentTarget.classList.remove('isDragOver');

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      window.alert('Please drop an image file.');
      return;
    }

    try {
      setPhotoDraftUploading(index, true);
      const url = await uploadPhotoToImgBB(file);
      const row = state.photoDraftRows[index];
      if (!row) return;

      row.url = url;
      refreshPhotoDraftDirty(row);

      if (!row.photoID) {
        await persistNewPhotoDraftRow(row);
      }

      row._uploading = false;
      renderPhotoEditorRows();
      document.getElementById(`photoUrl_${index}`)?.focus();
    } catch (err) {
      const row = state.photoDraftRows[index];
      if (row) {
        row._uploading = false;
      }
      renderPhotoEditorRows();
      window.alert(`Could not upload photo. ${err.message}`);
    }
  }

  function handlePhotoDragOver(event) {
    event.preventDefault();
    event.currentTarget?.classList.add('isDragOver');
  }

  function handlePhotoDragLeave(event) {
    event.currentTarget?.classList.remove('isDragOver');
  }

  function renderPhotoEditorRows() {
    if (!els.photoRows) return;

    const rows = state.photoDraftRows;
    els.photoRows.innerHTML = `
  <div class="photoEditorToolbar">
    <div class="photoAddDropZone" id="photoAddDropZone">
      <div class="photoToolbarButtons">
        <button class="expenseAddBtn expenseAddBtnTop" type="button" id="photoAddBtn" aria-label="Add photo row" title="Add photo">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>
          </svg>
          <span>Add photo</span>
        </button>

        ${supportsCameraCapture() ? `
          <button class="expenseAddBtn expenseAddBtnTop" type="button" id="photoCameraBtn" aria-label="Take photo" title="Take photo">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 4l1.4 2H15a2 2 0 0 1 2 2h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1a2 2 0 0 1 2-2Zm3 4.5A4.5 4.5 0 1 0 16.5 13 4.5 4.5 0 0 0 12 8.5Zm0 2A2.5 2.5 0 1 1 9.5 13 2.5 2.5 0 0 1 12 10.5Z"/>
            </svg>
            <span>Camera</span>
          </button>
        ` : ""}
      </div>

      <div class="photoAddDropText">Drop an image here</div>
    </div>
  </div>
  ${rows.length ? '' : '<div class="detailMeta">No photos for this game yet.</div>'}
  ` + rows.map((row, index) => `
      <div class="expenseEditorRow ${row._delete ? "expenseEditorRowDeleted" : ""}" data-index="${index}">
        <div class="expenseEditorRowHeader">
          <div class="expenseEditorRowTitle">${row.photoID ? `photoID: ${escapeHtml(row.photoID)}` : 'New photo'}</div>
          <button class="expenseIconBtn photoDeleteBtn" type="button" data-index="${index}" aria-label="Delete photo row" title="Delete photo">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v8h-2V9Zm4 0h2v8h-2V9ZM7 9h2v8H7V9Zm-1 12h12a2 2 0 0 0 2-2V7H4v12a2 2 0 0 0 2 2Z"/>
            </svg>
          </button>
        </div>

        <div class="photoEditorRow">
          <button class="photoEditorThumbBtn ${row._uploading ? 'isUploading' : ''}" type="button" data-photo-preview-index="${index}" data-index="${index}" aria-label="Preview photo ${index + 1}" ${row._delete ? 'disabled' : ''}>
            <div class="photoEditorPreview" data-index="${index}">
              <img src="${escapeAttr(getPhotoUrl(row.url))}" alt="${escapeAttr(row.photoID ? row.photoID : `Photo ${index + 1}`)}" loading="lazy">
              <div class="photoDropHint">Drop image here</div>
            </div>
          </button>

          <div class="editField photoUrlField">
            <label class="settingsLabel" for="photoUrl_${index}">URL</label>
            <input id="photoUrl_${index}" class="settingsInput photoDraftInput" data-field="url" data-index="${index}" type="text" value="${escapeAttr(row.url || "")}" ${row._delete || row._uploading ? "disabled" : ""}>
            <div class="photoUploadStatus">${row._uploading ? 'Uploading…' : ''}</div>
          </div>
        </div>

        ${row._delete ? '<div class="expenseDeletedLabel">Will be deleted on save</div>' : ''}
      </div>
    `).join("");

    els.photoRows.querySelectorAll(".photoDraftInput").forEach(input => {
      input.addEventListener("input", handlePhotoDraftInput);
    });

    els.photoRows.querySelectorAll(".photoDeleteBtn").forEach(btn => {
      btn.addEventListener("click", handlePhotoDraftDelete);
    });

    els.photoRows.querySelectorAll("[data-photo-preview-index]").forEach(btn => {
      btn.addEventListener("click", event => {
        const index = Number(event.currentTarget.dataset.photoPreviewIndex);
        openPhotoViewerFromDraft(index);
      });
      btn.addEventListener('dragover', handlePhotoDragOver);
      btn.addEventListener('dragleave', handlePhotoDragLeave);
      btn.addEventListener('drop', handlePhotoDrop);
    });

    document.getElementById("photoAddBtn")?.addEventListener("click", handlePhotoDraftAdd);
    document.getElementById("photoCameraBtn")?.addEventListener("click", openCameraCapture);

    const photoAddDropZone = document.getElementById('photoAddDropZone');
    photoAddDropZone?.addEventListener('dragover', handlePhotoAddDragOver);
    photoAddDropZone?.addEventListener('dragleave', handlePhotoAddDragLeave);
    photoAddDropZone?.addEventListener('drop', handlePhotoAddDrop);
  }

  async function openPhotoModal(id) {
    if (!state.auth.loggedIn) return;

    const machine = getMachineById(id);
    if (!machine || !els.photoModal) return;

    state.photoEditingId = id;

    if (!Array.isArray(machine.photos)) {
      renderDetail(machine);
      try {
        await hydrateMachinePhotos(machine);
      } catch (err) {
        window.alert(`Could not load photos. ${err.message}`);
        return;
      }
    }

    state.photoDraftRows = Array.isArray(machine.photos)
      ? machine.photos.map(clonePhotoForDraft)
      : [];

    els.photoGameId.textContent = machine.id || "—";
    renderPhotoEditorRows();

    const wasOpen = els.photoModal.classList.contains("open");
    els.photoOverlay?.classList.add("open");
    els.photoModal.classList.add("open");
    if (!wasOpen) {
      pushUiRoute('photo');
    }
  }

  function closePhotoModal(useHistoryBack = true) {
    const wasOpen = els.photoModal?.classList.contains("open");
    state.photoEditingId = null;
    state.photoDraftRows = [];
    els.photoModal?.classList.remove("open");
    els.photoOverlay?.classList.remove("open");
    els.photoForm?.reset();
    if (els.photoRows) {
      els.photoRows.innerHTML = "";
    }
    if (useHistoryBack && wasOpen) {
      history.back();
      return;
    }
    removeUiRoute('photo');
  }

  function handlePhotoDraftInput(event) {
    const field = event.target?.dataset?.field;
    const index = Number(event.target?.dataset?.index);
    if (!field || !Number.isInteger(index) || !state.photoDraftRows[index]) return;

    const row = state.photoDraftRows[index];
    row[field] = event.target.value;
    refreshPhotoDraftDirty(row);

    const previewImg = event.target.closest(".photoEditorRow")?.querySelector(".photoEditorPreview img");
    if (previewImg && field === "url") {
      previewImg.src = getPhotoUrl(row.url);
    }
  }

  function handlePhotoDraftDelete(event) {
    const index = Number(event.currentTarget?.dataset?.index);
    if (!Number.isInteger(index) || !state.photoDraftRows[index]) return;

    const row = state.photoDraftRows[index];

    if (row.photoID) {
      row._delete = !row._delete;
      row._dirty = true;
    } else {
      state.photoDraftRows.splice(index, 1);
    }

    renderPhotoEditorRows();
  }

  function handlePhotoDraftAdd() {
    state.photoDraftRows.unshift(makeLocalPhotoRow(state.photoEditingId));
    renderPhotoEditorRows();
    document.getElementById('photoUrl_0')?.focus();
  }

  function createPendingPhotoDraftAtTop() {
    const row = makeLocalPhotoRow(state.photoEditingId);
    row._uploading = true;
    state.photoDraftRows.unshift(row);
    renderPhotoEditorRows();
    return row;
  }

  async function addPhotoFromFile(file) {
    if (!file) throw new Error('No file provided.');
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error('Please drop an image file.');
    }

    const row = createPendingPhotoDraftAtTop();

    try {
      const url = await uploadPhotoToImgBB(file);
      row.url = url;
      refreshPhotoDraftDirty(row);
      await persistNewPhotoDraftRow(row);
      row._uploading = false;
      renderPhotoEditorRows();
      document.getElementById('photoUrl_0')?.focus();
    } catch (err) {
      const index = state.photoDraftRows.indexOf(row);
      if (index >= 0 && !row.photoID && !String(row.url || '').trim()) {
        state.photoDraftRows.splice(index, 1);
      } else {
        row._uploading = false;
      }
      renderPhotoEditorRows();
      throw err;
    }
  }

  function handlePhotoAddDrop(event) {
    event.preventDefault();
    const zone = event.currentTarget;
    zone?.classList.remove('isDragOver');

    const file = event.dataTransfer?.files?.[0];
    if (!file) return;

    addPhotoFromFile(file).catch(err => {
      window.alert(`Could not upload photo. ${err.message}`);
    });
  }

  function handlePhotoAddDragOver(event) {
    event.preventDefault();
    event.currentTarget?.classList.add('isDragOver');
  }

  function handlePhotoAddDragLeave(event) {
    event.currentTarget?.classList.remove('isDragOver');
  }

  function buildPhotoPayloadFromDraft(row) {
    return {
      photoID: String(row.photoID || "").trim(),
      gameID: String(row.gameID || state.photoEditingId || "").trim(),
      url: String(row.url || "").trim()
    };
  }

  function isPhotoDraftMeaningful(row) {
    return !!String(row.url || "").trim();
  }

  async function handlePhotoFormSubmit(event) {
    event.preventDefault();

    const id = state.photoEditingId;
    const machine = getMachineById(id);
    if (!id || !machine) return;

    const saveBtn = els.photoSaveBtn;
    const originalLabel = saveBtn?.textContent || "Save";

    try {
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
      }

      for (const row of state.photoDraftRows) {
        if (row._delete && row.photoID) {
          await apiPost("deletePhoto", { photoID: row.photoID });
          continue;
        }

        if (row._delete) continue;
        if (!isPhotoDraftMeaningful(row)) continue;

        const payload = buildPhotoPayloadFromDraft(row);

        if (payload.photoID) {
          if (!row._dirty) continue;
          await apiPost("updatePhoto", payload);
        } else {
          await apiPost("createPhoto", payload);
        }
      }

      await refreshMachinePhotos(machine);
      closePhotoModal();
    } catch (err) {
      window.alert(`Could not save photos. ${err.message}`);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = originalLabel;
      }
    }
  }

  function getPhotoViewerRowsFromMachine(machine) {
    return Array.isArray(machine?.photos) ? machine.photos.filter(photo => String(photo?.url || '').trim()) : [];
  }

  function getPhotoViewerRowsFromDraft() {
    return state.photoDraftRows.filter(row => !row._delete && String(row.url || '').trim());
  }

  function renderPhotoViewer() {
    const viewerState = state.photoViewer;
    const rows = Array.isArray(viewerState.rows) ? viewerState.rows : [];
    if (!viewerState.open || !rows.length) return;

    const safeIndex = Math.max(0, Math.min(Number(viewerState.index || 0), rows.length - 1));
    viewerState.index = safeIndex;

    const row = rows[safeIndex];
    const isMachineSource = viewerState.source === 'machine';
    const machine = isMachineSource ? getMachineById(viewerState.machineId) : null;
    const titleText = isMachineSource
      ? `${machine?.id || ''}${machine?.title ? ` • ${machine.title}` : ''}`
      : `${state.photoEditingId || ''}`;

    els.photoViewerImage.src = getPhotoUrl(row.url);
    els.photoViewerImage.alt = isMachineSource ? (machine?.title || 'Photo') : `Photo ${safeIndex + 1}`;
    els.photoViewerCaption.textContent = `${titleText} • ${safeIndex + 1} / ${rows.length}`.trim();

    const hasPrev = safeIndex > 0;
    const hasNext = safeIndex < rows.length - 1;
    els.photoViewerPrevBtn?.classList.toggle('hidden', !hasPrev);
    els.photoViewerNextBtn?.classList.toggle('hidden', !hasNext);

    preloadImageUrl(row.url);
    if (rows[safeIndex - 1]) preloadImageUrl(rows[safeIndex - 1].url);
    if (rows[safeIndex + 1]) preloadImageUrl(rows[safeIndex + 1].url);
  }

  function openPhotoViewer(machine, index = 0) {
    const rows = getPhotoViewerRowsFromMachine(machine);
    if (!rows.length) return;

    const wasOpen = state.photoViewer.open;

    state.photoViewer.open = true;
    state.photoViewer.source = 'machine';
    state.photoViewer.machineId = machine?.id || null;
    state.photoViewer.rows = rows;
    state.photoViewer.index = Math.max(0, Math.min(index, rows.length - 1));

    renderPhotoViewer();
    els.photoViewerOverlay?.classList.add('open');
    els.photoViewerModal?.classList.add('open');

    if (!wasOpen) {
      pushUiRoute('photoViewer');
    }
  }

  function openPhotoViewerFromDraft(index = 0) {
    const rows = getPhotoViewerRowsFromDraft();
    if (!rows.length) return;

    const wasOpen = state.photoViewer.open;

    state.photoViewer.open = true;
    state.photoViewer.source = 'draft';
    state.photoViewer.machineId = state.photoEditingId || null;
    state.photoViewer.rows = rows;
    state.photoViewer.index = Math.max(0, Math.min(index, rows.length - 1));

    renderPhotoViewer();
    els.photoViewerOverlay?.classList.add('open');
    els.photoViewerModal?.classList.add('open');

    if (!wasOpen) {
      pushUiRoute('photoViewer');
    }
  }

  function changePhotoViewer(direction = 1) {
    if (!state.photoViewer.open) return;

    const rows = Array.isArray(state.photoViewer.rows) ? state.photoViewer.rows : [];
    if (!rows.length) return;

    const nextIndex = Math.max(0, Math.min(rows.length - 1, Number(state.photoViewer.index || 0) + direction));
    if (nextIndex === Number(state.photoViewer.index || 0)) return;

    state.photoViewer.index = nextIndex;
    renderPhotoViewer();
  }


  function getSwipeDirection(startX, startY, endX, endY) {
    const deltaX = Number(endX || 0) - Number(startX || 0);
    const deltaY = Number(endY || 0) - Number(startY || 0);

    if (Math.abs(deltaX) < 40) return 0;
    if (Math.abs(deltaX) <= Math.abs(deltaY)) return 0;

    return deltaX < 0 ? 1 : -1;
  }

  function handleDetailPhotoTouchStart(event) {
    const touch = event.changedTouches?.[0];
    const machineId = event.currentTarget?.dataset?.photoSwipeId;
    if (!touch || !machineId) return;

    state.detailPhotoTouch.machineId = machineId;
    state.detailPhotoTouch.touchStartX = touch.clientX;
    state.detailPhotoTouch.touchStartY = touch.clientY;
  }

  function handleDetailPhotoTouchEnd(event) {
    const touch = event.changedTouches?.[0];
    const machineId = event.currentTarget?.dataset?.photoSwipeId || state.detailPhotoTouch.machineId;
    if (!touch || !machineId) return;

    const direction = getSwipeDirection(
      state.detailPhotoTouch.touchStartX,
      state.detailPhotoTouch.touchStartY,
      touch.clientX,
      touch.clientY
    );

    state.detailPhotoTouch.machineId = null;
    state.detailPhotoTouch.touchStartX = 0;
    state.detailPhotoTouch.touchStartY = 0;

    if (!direction) return;
    changeDetailPhoto(machineId, direction);
  }

  function handlePhotoViewerTouchStart(event) {
    const touch = event.changedTouches?.[0];
    if (!touch) return;

    state.photoViewer.touchStartX = touch.clientX;
    state.photoViewer.touchStartY = touch.clientY;
  }

  function handlePhotoViewerTouchEnd(event) {
    const touch = event.changedTouches?.[0];
    if (!touch) return;

    const direction = getSwipeDirection(
      state.photoViewer.touchStartX,
      state.photoViewer.touchStartY,
      touch.clientX,
      touch.clientY
    );

    state.photoViewer.touchStartX = 0;
    state.photoViewer.touchStartY = 0;

    if (!direction) return;
    changePhotoViewer(direction);
  }

  function closePhotoViewer(useHistoryBack = true) {
    const wasOpen = state.photoViewer.open;

    state.photoViewer.open = false;
    state.photoViewer.source = null;
    state.photoViewer.machineId = null;
    state.photoViewer.rows = [];
    state.photoViewer.index = 0;
    state.photoViewer.touchStartX = 0;
    state.photoViewer.touchStartY = 0;

    els.photoViewerModal?.classList.remove('open');
    els.photoViewerOverlay?.classList.remove('open');

    if (useHistoryBack && wasOpen) {
      history.back();
      return;
    }
    removeUiRoute('photoViewer');
  }

  function changeDetailPhoto(machineId, direction = 1) {
    const machine = getMachineById(machineId);
    const photos = Array.isArray(machine?.photos) ? machine.photos : [];
    if (!machine || !photos.length) return;

    const maxIndex = photos.length - 1;
    const nextIndex = Math.max(0, Math.min(maxIndex, Number(machine.photoCarouselIndex || 0) + direction));
    if (nextIndex === Number(machine.photoCarouselIndex || 0)) return;

    machine.photoCarouselIndex = nextIndex;
    deferPhotoPreload(machine, nextIndex);
    if (state.selectedId === machine.id) {
      renderDetail(machine);
    }
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

    const wasOpen = els.editModal.classList.contains("open");
    els.editOverlay?.classList.add("open");
    els.editModal.classList.add("open");
    if (!wasOpen) {
      pushUiRoute('edit');
    }
    els.editTitle?.focus();
  }

  function closeEditModal(useHistoryBack = true) {
    const wasOpen = els.editModal?.classList.contains("open");
    state.editingId = null;
    els.editModal?.classList.remove("open");
    els.editOverlay?.classList.remove("open");
    els.editForm?.reset();
    if (useHistoryBack && wasOpen) {
      history.back();
      return;
    }
    removeUiRoute('edit');
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
    merged.photos = existing.photos;
    merged.photoStatus = existing.photoStatus;
    merged.photoPromise = existing.photoPromise;
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
    item.photos = null;
    item.photoStatus = "idle";
    item.photoPromise = null;
    item.photoCarouselIndex = 0;

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

    els.expenseCloseBtn?.addEventListener("click", closeExpenseModal);
    els.expenseCancelBtn?.addEventListener("click", closeExpenseModal);
    els.expenseOverlay?.addEventListener("click", closeExpenseModal);
    els.expenseForm?.addEventListener("submit", handleExpenseFormSubmit);

    els.photoCloseBtn?.addEventListener("click", closePhotoModal);
    els.photoCancelBtn?.addEventListener("click", closePhotoModal);
    els.photoOverlay?.addEventListener("click", closePhotoModal);
    els.photoForm?.addEventListener("submit", handlePhotoFormSubmit);

    els.photoViewerCloseBtn?.addEventListener("click", closePhotoViewer);
    els.photoViewerPrevBtn?.addEventListener("click", event => { event.stopPropagation(); changePhotoViewer(-1); });
    els.photoViewerNextBtn?.addEventListener("click", event => { event.stopPropagation(); changePhotoViewer(1); });
    els.photoViewerOverlay?.addEventListener("click", closePhotoViewer);
    els.photoViewerBody?.addEventListener('touchstart', handlePhotoViewerTouchStart, { passive: true });
    els.photoViewerBody?.addEventListener('touchend', handlePhotoViewerTouchEnd, { passive: true });

    els.closeDetailBtn.addEventListener("click", closeMobileDetail);
    els.mobileOverlay.addEventListener("click", closeMobileDetail);

    window.addEventListener("resize", updateSelectedCard);
    window.addEventListener('keydown', event => {
      if (!state.photoViewer.open) return;
      if (event.key === 'Escape') {
        closePhotoViewer();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        changePhotoViewer(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        changePhotoViewer(1);
      }
    });

    window.addEventListener("popstate", () => {
      closeTopUiLayerFromHistory();
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
    })
      .sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
      );

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
        pushUiRoute('detail');
      }
    }

    renderDetail(machine);
    updateSelectedCard();
  }

  function closeMobileDetail(useHistoryBack = true) {
    const wasOpen = els.detailPane.classList.contains("open");

    if (state.photoViewer.open) {
      closePhotoViewer(false);
    }

    els.detailPane.classList.remove("open");
    els.mobileOverlay.classList.remove("open");

    if (useHistoryBack && wasOpen) {
      history.back();
      return;
    }
    removeUiRoute('detail');
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
        ? sortExpensesByDateDesc(machine.expenses).map(exp => `
        <div class="expenseRow">
          <div class="expenseMain">
            <div class="expenseTop">
              ${escapeHtml(exp.date || "—")}
              ${exp.category ? ` • ${escapeHtml(exp.category)}` : ""}
              ${exp.vendor ? ` • ${escapeHtml(exp.vendor)}` : ""}
            </div>
            <div class="expenseDescMuted">
              ${escapeHtml(exp.description || "—")}
            </div>
          </div>
          <div class="expenseAmount">${escapeHtml(formatMoney(exp.amount))}</div>
        </div>
      `).join("")
        : `<div class="detailMeta">No expense entries yet.</div>`;

    const photoSectionMarkup = (() => {
      if (machine.photoStatus === "loading" || machine.photos === null) {
        return `<div class="detailMeta detailMetaLoading">Loading photos…</div>`;
      }

      if (machine.photoStatus === "error") {
        return `<div class="detailMeta">Could not load photos.</div>`;
      }

      if (Array.isArray(machine.photos) && machine.photos.length) {
        const activeIndex = Math.max(0, Math.min(Number(machine.photoCarouselIndex || 0), machine.photos.length - 1));
        const activePhoto = machine.photos[activeIndex];
        const hasPrev = activeIndex > 0;
        const hasNext = activeIndex < machine.photos.length - 1;
        return `
          <div class="photoCarouselSingleView">
            ${hasPrev ? `<button class="photoNavBtn photoNavBtnPrev" type="button" data-photo-prev-id="${escapeAttr(machine.id)}" aria-label="Previous photo">‹</button>` : ``}
            <button class="photoStage" type="button" data-photo-index="${activeIndex}" data-photo-swipe-id="${escapeAttr(machine.id)}" aria-label="Open photo ${activeIndex + 1}">
              <img src="${escapeAttr(getPhotoUrl(activePhoto.url))}" alt="${escapeAttr(`${machine.title} photo ${activeIndex + 1}`)}" loading="eager" fetchpriority="high" decoding="async">
            </button>
            ${hasNext ? `<button class="photoNavBtn photoNavBtnNext" type="button" data-photo-next-id="${escapeAttr(machine.id)}" aria-label="Next photo">›</button>` : ``}
          </div>
          ${machine.photos.length > 1 ? `
            <div class="photoPager">${activeIndex + 1} / ${machine.photos.length}</div>
          ` : ``}
        `;
      }

      return `<div class="detailMeta">No additional photos.</div>`;
    })();

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
        <div class="detailSectionHeader">
          <h3>Photos</h3>
          ${state.auth.loggedIn ? `
            <button class="detailExpenseEditBtn" type="button" data-photo-edit-id="${escapeAttr(machine.id)}" aria-label="Edit photos" title="Edit photos">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.96 1.96 3.75 3.75 2.13-1.79Z"/>
              </svg>
            </button>
          ` : ""}
        </div>
        ${photoSectionMarkup}
      </section>

      <section class="detailSection">
        <div class="detailSectionHeader">
          <h3>Expenses</h3>
          ${state.auth.loggedIn ? `
            <button class="detailExpenseEditBtn" type="button" data-expense-edit-id="${escapeAttr(machine.id)}" aria-label="Edit expenses" title="Edit expenses">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0l-1.96 1.96 3.75 3.75 2.13-1.79Z"/>
              </svg>
            </button>
          ` : ''}
        </div>
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

          ${machine.purchaseDate || machine.purchaseFrom ? `
            <div class="expenseDescMuted">
              ${machine.purchaseDate ? escapeHtml(formatApiDate(machine.purchaseDate)) : ""}
              ${machine.purchaseDate && machine.purchaseFrom ? " • " : ""}
              ${machine.purchaseFrom ? escapeHtml(machine.purchaseFrom) : ""}
            </div>
          ` : ""}

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

        ${machine.soldDate || machine.soldTo ? `
          <div class="expenseDescMuted">
            ${machine.soldDate ? escapeHtml(formatApiDate(machine.soldDate)) : ""}
            ${machine.soldDate && machine.soldTo ? " • " : ""}
            ${machine.soldTo ? escapeHtml(machine.soldTo) : ""}
          </div>
        ` : ""}
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

    if (machine.photoStatus === "idle" && machine.photos === null) {
      queuePhotoLoadForMachine(machine);
    }

    els.detailTitle.textContent = `${machine.id} • ${machine.title}`;
    els.detailContent.innerHTML = buildDetailMarkup(machine, true);

    const expenseEditBtn = els.detailContent.querySelector('[data-expense-edit-id]');
    expenseEditBtn?.addEventListener('click', event => {
      event.stopPropagation();
      openExpenseModal(machine.id);
    });

    const photoEditBtn = els.detailContent.querySelector('[data-photo-edit-id]');
    photoEditBtn?.addEventListener('click', event => {
      event.stopPropagation();
      openPhotoModal(machine.id);
    });

    els.detailContent.querySelectorAll('[data-photo-index]').forEach(btn => {
      btn.addEventListener('click', event => {
        const index = Number(event.currentTarget.dataset.photoIndex);
        openPhotoViewer(machine, index);
      });
      btn.addEventListener('touchstart', handleDetailPhotoTouchStart, { passive: true });
      btn.addEventListener('touchend', handleDetailPhotoTouchEnd, { passive: true });
    });

    els.detailContent.querySelector(`[data-photo-prev-id="${CSS.escape(machine.id)}"]`)?.addEventListener('click', event => {
      event.stopPropagation();
      changeDetailPhoto(machine.id, -1);
    });

    els.detailContent.querySelector(`[data-photo-next-id="${CSS.escape(machine.id)}"]`)?.addEventListener('click', event => {
      event.stopPropagation();
      changeDetailPhoto(machine.id, 1);
    });

    if (Array.isArray(machine.photos) && machine.photos.length) {
      deferPhotoPreload(machine, Number(machine.photoCarouselIndex || 0));
    }
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
      return getPhotoUrl(machine.photos[0]?.url);
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
      return getPhotoUrl(machine.photos[0]?.url);
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