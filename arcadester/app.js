(() => {
  const state = {
    allMachines: [],
    filteredMachines: [],
    selectedId: null
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

  window.InventoryLoader = {
    async load(url = "arcadester.json") {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load inventory: HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("Inventory JSON must be an array.");
      }

      return data.map(normalizeMachine);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function normalizeMachine(machine) {
    const item = { ...machine };

    item.id = String(item.id || "");
    item.title = String(item.title || "").trim();
    item.year = item.year ?? null;
    item.manufacturer = String(item.manufacturer || "").trim();
    item.genre = String(item.genre || "").trim();
    item.location = String(item.location || "").trim();
    item.condition = String(item.condition || "").trim();
    item.purchasePrice = toNumberOrNull(item.purchasePrice);
    item.totalExpenses = toNumberOrNull(item.totalExpenses);
    item.totalCost = toNumberOrNull(item.totalCost);
    item.klov = String(item.klov || "").trim();

    item.notes = String(item.notes || "").trim();
    item.photos = Array.isArray(item.photos) ? item.photos : [];
    item.expenses = Array.isArray(item.expenses) ? item.expenses : [];
    item.soldPrice = toNumberOrNull(item.soldPrice);

    return item;
  }

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async function init() {
    wireEvents();

    try {
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

    window.addEventListener("resize", () => {
      if (window.innerWidth >= 1000) {
        els.detailPane.classList.remove("open");
        els.mobileOverlay.classList.remove("open");
      }
    });
  }

  function populateFilters() {
    const locations = uniqueSorted(state.allMachines.map(m => m.location).filter(Boolean));
    const conditions = uniqueSorted(state.allMachines.map(m => m.condition).filter(Boolean));

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
      if (location && machine.location !== location) return false;
      if (condition && machine.condition !== condition) return false;

      if (!q) return true;

      const blob = [
        machine.title,
        machine.manufacturer,
        machine.genre,
        machine.location,
        machine.condition,
        machine.year
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

    const isDesktop = window.innerWidth >= 1000;

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

      card.innerHTML = `
        <div class="cardPhotoWrap">
          <img class="cardPhoto" src="${escapeAttr(getPhotoUrl(machine.photos[0]))}" alt="${escapeAttr(machine.title)}">
        </div>

        <div class="cardBody">

          <div class="cardHeader">
            <h3 class="cardTitle">${escapeHtml(machine.title)}</h3>
            ${machine.klov
          ? `<a class="cardKlov" href="${escapeAttr(machine.klov)}" target="_blank" rel="noopener noreferrer">KLOV</a>`
          : ``
        }
          </div>

          <div class="cardFooter">
            <button class="detailsBtn" type="button">Details</button>
          </div>

        </div>
      `;

      card.addEventListener("click", event => {
        const clickedKlov = event.target.closest("a");
        if (clickedKlov) return;

        if (!isDesktop) {
          selectMachine(machine.id, true);
        }
      });

      const detailsBtn = card.querySelector(".detailsBtn");
      detailsBtn.addEventListener("click", event => {
        event.stopPropagation();
        selectMachine(machine.id, true);
      });

      row.appendChild(card);

      if (isDesktop) {
        const inlineDetail = document.createElement("section");
        inlineDetail.className = "machineDetailInline";
        inlineDetail.innerHTML = buildDetailMarkup(machine, false);
        wireDetailButtons(inlineDetail, machine);
        row.appendChild(inlineDetail);
      }

      els.cardsGrid.appendChild(row);
    }
  }

  function selectMachine(id, openOnMobile) {
    const machine = state.allMachines.find(m => m.id === id);
    if (!machine) return;

    state.selectedId = id;
    renderDetail(machine);
    updateSelectedCard();

    if (openOnMobile && window.innerWidth < 1000) {
      els.detailPane.classList.add("open");
      els.mobileOverlay.classList.add("open");
    }
  }

  function closeMobileDetail() {
    if (window.innerWidth >= 1000) return;
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

    return `
    ${includeHeader ? "" : `<div class="detailHeader"><h2 class="detailTitle">${escapeHtml(machine.title)}</h2></div>`}

    <div class="detailContent">
      <section class="detailSection">
        <div class="detailButtons">
          ${machine.klov ? `<a class="detailBtn" href="${escapeAttr(machine.klov)}" target="_blank" rel="noopener noreferrer">Open KLOV</a>` : ""}
          <button class="detailBtn editMachineBtn" type="button">Edit</button>
        </div>
      </section>

      <section class="detailSection">
        <h3>Machine info</h3>
        <div class="detailMeta">
          <div class="detailMetaRow"><span class="label">Year</span><span class="value">${escapeHtml(machine.year ?? "—")}</span></div>
          <div class="detailMetaRow"><span class="label">Manufacturer</span><span class="value">${escapeHtml(machine.manufacturer || "—")}</span></div>
          <div class="detailMetaRow"><span class="label">Genre</span><span class="value">${escapeHtml(machine.genre || "—")}</span></div>
          <div class="detailMetaRow"><span class="label">Location</span><span class="value">${escapeHtml(machine.location || "—")}</span></div>
          <div class="detailMetaRow"><span class="label">Condition</span><span class="value">${escapeHtml(machine.condition || "—")}</span></div>
        </div>
      </section>

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

  function wireDetailButtons(rootEl, machine) {
    const editBtn = rootEl.querySelector(".editMachineBtn");
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        alert(`Edit UI for ${machine.title} can be wired next.`);
      });
    }
  }

  function renderDetail(machine) {
    if (!machine) {
      els.detailTitle.textContent = "Select a machine";
      els.detailContent.innerHTML = `<div class="detailPlaceholder">No machine selected.</div>`;
      return;
    }

    els.detailTitle.textContent = machine.title;
    els.detailContent.innerHTML = buildDetailMarkup(machine, true);

    wireDetailButtons(els.detailContent, machine);
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
    if (machine.location) parts.push(machine.location);
    if (machine.condition) parts.push(machine.condition);
    return parts.length ? parts.join(" • ") : "—";
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

  function getPhotoUrl(filename) {
    if (!filename) return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480">
        <rect width="640" height="480" fill="#111"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#777" font-family="Arial" font-size="28">
          No Photo
        </text>
      </svg>`
    );

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