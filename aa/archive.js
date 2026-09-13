// Filename: archive.js
// Version: 20260913-165823

"use strict";

const DEFAULT_PAGE_SIZE = 100;
const BODY_SEARCH_BATCH_SIZE = 6;
const SETTINGS_KEY = "bally-alley-archive-settings";
const bodyChunkCache = new Map();
const bodySearchWork = {
    generation: 0,
    running: false,
    processed: 0,
    total: 0
};
const state = {
    manifest: null,
    messages: [],
    keywords: [],
    topics: [],
    senders: [],
    view: "messages",
    query: "",
    sender: null,
    keyword: null,
    topic: null,
    previewNumber: null,
    searchBodies: false,
    bodySearchMatches: new Set(),
    bodySearchSnippets: new Map(),
    messageSort: {
        column: "number",
        direction: "desc"
    },
    senderSort: {
        column: "count",
        direction: "desc"
    },
    topicSort: {
        column: "name",
        direction: "asc"
    },
    pageSize: DEFAULT_PAGE_SIZE,
    page: 1
};

const elements = {
    appChrome: document.querySelector("#appChrome"),
    settingsArchiveSummary: document.querySelector("#settingsArchiveSummary"),
    search: document.querySelector("#searchInput"),
    content: document.querySelector("#content"),
    activeFilter: document.querySelector("#activeFilter"),
    pagination: document.querySelector("#pagination"),
    previous: document.querySelector("#previousPage"),
    next: document.querySelector("#nextPage"),
    pageStatus: document.querySelector("#pageStatus"),
    tableTemplate: document.querySelector("#messageTableTemplate"),
    tabs: [...document.querySelectorAll("[data-view]")],
    bodySearchButton: document.querySelector("#bodySearchButton"),
    settingsButton: document.querySelector("#settingsButton"),
    settingsDialog: document.querySelector("#settingsDialog"),
    themeSetting: document.querySelector("#themeSetting"),
    pageSizeSetting: document.querySelector("#pageSizeSetting")
};

function loadSettings() {
    let settings = {};
    try {
        settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch {
        settings = {};
    }

    const theme = ["system", "light", "dark"].includes(settings.theme)
        ? settings.theme
        : "system";
    const pageSize = [50, 100, 200].includes(Number(settings.pageSize))
        ? Number(settings.pageSize)
        : DEFAULT_PAGE_SIZE;

    state.pageSize = pageSize;
    elements.themeSetting.value = theme;
    elements.pageSizeSetting.value = String(pageSize);
    applyTheme(theme);
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
            theme: elements.themeSetting.value,
            pageSize: state.pageSize
        }));
    } catch {
        // Browser privacy settings may disable local storage.
    }
}

function applyTheme(theme) {
    if (theme === "system") {
        document.documentElement.removeAttribute("data-theme");
    } else {
        document.documentElement.dataset.theme = theme;
    }
}

function updateMessageCounter(displayedCount = state.messages.length) {
    const totalCount = state.manifest?.messageCount ?? state.messages.length;
    const text = `${displayedCount.toLocaleString()} / ${totalCount.toLocaleString()}`;
    for (const counter of document.querySelectorAll("[data-message-counter]")) {
        counter.textContent = text;
    }
}

function buildSenderDirectory(messages) {
    const senders = new Map();
    for (const message of messages) {
        const current = senders.get(message.senderKey) || {
            key: message.senderKey,
            name: message.senderName || message.sender,
            address: message.senderAddress,
            count: 0,
            lastPosted: message.date
        };
        current.count += 1;
        if (new Date(message.date).getTime() > new Date(current.lastPosted).getTime()) {
            current.lastPosted = message.date;
        }
        senders.set(message.senderKey, current);
    }
    return [...senders.values()];
}

function parseHash() {
    const value = location.hash.replace(/^#/, "");
    const [kind, encodedValue] = value.split("=", 2);
    state.sender = null;
    state.keyword = null;
    state.topic = null;
    state.previewNumber = null;

    if (kind === "sender" && encodedValue) {
        state.view = "messages";
        state.sender = decodeURIComponent(encodedValue);
    } else if (kind === "keyword" && encodedValue) {
        state.view = "messages";
        state.keyword = decodeURIComponent(encodedValue);
    } else if (kind === "topic" && encodedValue) {
        state.view = "messages";
        state.topic = decodeURIComponent(encodedValue);
    } else if (["messages", "senders", "topics", "keywords"].includes(kind)) {
        state.view = kind;
    } else {
        state.view = "messages";
    }
    state.page = 1;
}

function searchableMessage(message) {
    return `${message.number} ${message.date} ${message.sender} ${message.subject}`
        .toLocaleLowerCase("en-US");
}

function fetchBodyChunk(chunkName) {
    let request = bodyChunkCache.get(chunkName);
    if (!request) {
        const version = encodeURIComponent(state.manifest.generatedAt);
        request = fetch(`data/bodies/${chunkName}?v=${version}`).then((response) => {
            if (!response.ok) {
                throw new Error(`Message preview data returned HTTP ${response.status}.`);
            }
            return response.json();
        });
        bodyChunkCache.set(chunkName, request);
        request.catch(() => bodyChunkCache.delete(chunkName));
    }
    return request;
}

function setBodySearchProgress(running, processed = 0, total = 0) {
    bodySearchWork.running = running;
    bodySearchWork.processed = processed;
    bodySearchWork.total = total;
    document.documentElement.classList.toggle("is-body-searching", running);
    document.body.toggleAttribute("aria-busy", running);
    updateBodySearchControl();
}

function updateBodySearchControl() {
    const button = elements.bodySearchButton;
    button.hidden = state.view !== "messages";
    button.classList.toggle("active", state.searchBodies);
    button.classList.toggle("loading", bodySearchWork.running);
    button.setAttribute("aria-pressed", String(state.searchBodies));

    const percent = bodySearchWork.total
        ? Math.round(bodySearchWork.processed * 100 / bodySearchWork.total)
        : 0;
    button.style.setProperty("--body-search-progress", `${percent}%`);

    let label = "Include message text in search";
    if (bodySearchWork.running) {
        label = `Searching message text: ${percent}%`;
    } else if (state.searchBodies) {
        label = "Message text search enabled";
    }
    button.setAttribute("aria-label", label);
    button.title = label;
}

function buildBodySearchSnippet(body, query) {
    const text = String(body || "").replace(/\s+/g, " ").trim();
    const matchIndex = text.toLocaleLowerCase("en-US").indexOf(query);
    if (matchIndex < 0) {
        return "";
    }

    let start = Math.max(0, matchIndex - 70);
    let end = Math.min(text.length, matchIndex + query.length + 100);
    if (start > 0) {
        const nextSpace = text.indexOf(" ", start);
        if (nextSpace >= 0 && nextSpace < matchIndex) {
            start = nextSpace + 1;
        }
    }
    if (end < text.length) {
        const previousSpace = text.lastIndexOf(" ", end);
        if (previousSpace > matchIndex + query.length) {
            end = previousSpace;
        }
    }
    return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function searchMatchSnippet(text, query) {
    const snippet = document.createElement("div");
    snippet.className = "search-match-snippet";
    const matchIndex = text.toLocaleLowerCase("en-US").indexOf(query);
    if (matchIndex < 0) {
        snippet.textContent = text;
        return snippet;
    }

    const mark = document.createElement("mark");
    mark.textContent = text.slice(matchIndex, matchIndex + query.length);
    snippet.append(
        document.createTextNode(text.slice(0, matchIndex)),
        mark,
        document.createTextNode(text.slice(matchIndex + query.length))
    );
    return snippet;
}

async function searchMessageBodies() {
    const generation = ++bodySearchWork.generation;
    state.bodySearchMatches = new Set();
    state.bodySearchSnippets = new Map();
    const query = state.query.toLocaleLowerCase("en-US");

    if (!state.searchBodies || state.view !== "messages" || !query) {
        setBodySearchProgress(false);
        return;
    }

    const chunks = [...new Set(state.messages.map((message) => message.bodyChunk))];
    setBodySearchProgress(true, 0, chunks.length);

    for (let index = 0; index < chunks.length; index += BODY_SEARCH_BATCH_SIZE) {
        const batch = chunks.slice(index, index + BODY_SEARCH_BATCH_SIZE);
        const results = await Promise.allSettled(batch.map(fetchBodyChunk));
        if (generation !== bodySearchWork.generation) {
            return;
        }

        for (const result of results) {
            if (result.status !== "fulfilled") {
                console.error(result.reason);
                continue;
            }
            for (const [messageNumber, body] of Object.entries(result.value)) {
                if (String(body || "").toLocaleLowerCase("en-US").includes(query)) {
                    const number = Number(messageNumber);
                    state.bodySearchMatches.add(number);
                    state.bodySearchSnippets.set(number, buildBodySearchSnippet(body, query));
                }
            }
        }

        setBodySearchProgress(true, Math.min(index + batch.length, chunks.length), chunks.length);
        renderMessages();
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    if (generation === bodySearchWork.generation) {
        setBodySearchProgress(false, chunks.length, chunks.length);
        renderMessages();
    }
}

function filteredMessages() {
    let messages = state.messages;

    if (state.sender) {
        messages = messages.filter((message) => message.senderKey === state.sender);
    }

    if (state.keyword) {
        const keyword = state.keywords.find((entry) => entry.term === state.keyword);
        const messageNumbers = new Set(keyword?.messages || []);
        messages = messages.filter((message) => messageNumbers.has(message.number));
    }

    if (state.topic) {
        const topic = state.topics.find((entry) => entry.id === state.topic);
        const messageNumbers = new Set(topic?.messages || []);
        messages = messages.filter((message) => messageNumbers.has(message.number));
    }

    if (state.query) {
        const query = state.query.toLocaleLowerCase("en-US");
        messages = messages.filter((message) =>
            searchableMessage(message).includes(query) ||
            (state.searchBodies && state.bodySearchMatches.has(Number(message.number)))
        );
    }

    return messages;
}

function senderCell(message) {
    const wrapper = document.createElement("div");
    const name = document.createElement("div");
    name.textContent = message.senderName || message.sender;
    wrapper.append(name);
    if (message.senderAddress) {
        const address = document.createElement("div");
        address.className = "sender-address";
        address.textContent = message.senderAddress;
        wrapper.append(address);
    }
    return wrapper;
}

function previewTrigger(message, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-link message-preview-trigger";
    button.textContent = label;
    button.setAttribute("aria-expanded", String(state.previewNumber === message.number));
    button.addEventListener("click", () => {
        state.previewNumber = state.previewNumber === message.number ? null : message.number;
        renderMessages();
    });
    return button;
}

async function loadMessageBody(message, bodyElement) {
    try {
        const bodies = await fetchBodyChunk(message.bodyChunk);
        if (document.contains(bodyElement) && state.previewNumber === message.number) {
            bodyElement.textContent = bodies[message.number] || "This message has no text body.";
        }
    } catch (error) {
        bodyChunkCache.delete(message.bodyChunk);
        if (document.contains(bodyElement) && state.previewNumber === message.number) {
            bodyElement.textContent = `${error.message} Run npm run export to generate preview data.`;
        }
    }
}

function messagePreviewRow(message) {
    const row = document.createElement("tr");
    row.className = "message-preview-row";
    const cell = document.createElement("td");
    cell.colSpan = 4;

    const preview = document.createElement("section");
    preview.className = "message-preview";
    preview.setAttribute("aria-label", `Preview of message ${message.number}`);

    const toolbar = document.createElement("div");
    toolbar.className = "message-preview-toolbar";
    const actions = document.createElement("div");
    actions.className = "message-preview-actions";
    const open = document.createElement("a");
    open.href = message.url;
    open.target = "_blank";
    open.rel = "noopener";
    open.className = "open-message-button";
    open.textContent = "Open on Groups.io";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "close-preview-button";
    close.setAttribute("aria-label", "Close message preview");
    close.textContent = "×";
    close.addEventListener("click", () => {
        state.previewNumber = null;
        renderMessages();
    });
    actions.append(open, close);
    toolbar.append(actions);

    const body = document.createElement("div");
    body.className = "message-preview-body";
    body.textContent = "Loading message…";
    preview.append(toolbar, body);
    cell.append(preview);
    row.append(cell);
    loadMessageBody(message, body);
    return row;
}

function messageSortValue(message, column) {
    if (column === "number") {
        return Number(message.number);
    }
    if (column === "date") {
        return new Date(message.date).getTime();
    }
    if (column === "sender") {
        return `${message.senderName || message.sender} ${message.senderAddress || ""}`
            .toLocaleLowerCase("en-US");
    }
    return message.subject.toLocaleLowerCase("en-US");
}

function sortedMessages(messages) {
    const { column, direction } = state.messageSort;
    const multiplier = direction === "asc" ? 1 : -1;
    return [...messages].sort((left, right) => {
        const leftValue = messageSortValue(left, column);
        const rightValue = messageSortValue(right, column);
        const comparison = typeof leftValue === "string"
            ? leftValue.localeCompare(rightValue)
            : leftValue - rightValue;
        return comparison * multiplier || Number(right.number) - Number(left.number);
    });
}

let busy = false;

function runBusy(task) {
    if (busy) {
        return;
    }

    busy = true;
    document.documentElement.classList.add("is-busy");
    document.body.setAttribute("aria-busy", "true");

    requestAnimationFrame(() => {
        setTimeout(() => {
            try {
                task();
            } finally {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        document.documentElement.classList.remove("is-busy");
                        document.body.removeAttribute("aria-busy");
                        busy = false;
                    }, 0);
                });
            }
        }, 0);
    });
}

function configureMessageSort(table) {
    const labels = {
        number: "Msg #",
        date: "Date",
        sender: "Sender",
        subject: "Subject"
    };

    for (const button of table.querySelectorAll("[data-message-sort]")) {
        const column = button.dataset.messageSort;
        const active = state.messageSort.column === column;
        button.textContent = `${labels[column]}${active
            ? (state.messageSort.direction === "asc" ? " ▲" : " ▼")
            : ""}`;
        const header = button.closest("th");
        if (active) {
            header.setAttribute(
                "aria-sort",
                state.messageSort.direction === "asc" ? "ascending" : "descending"
            );
        }
        button.addEventListener("click", () => {
            runBusy(() => {
                if (active) {
                    state.messageSort.direction = state.messageSort.direction === "asc" ? "desc" : "asc";
                } else {
                    state.messageSort.column = column;
                    state.messageSort.direction = ["number", "date"].includes(column) ? "desc" : "asc";
                }
                state.page = 1;
                state.previewNumber = null;
                renderMessages();
                scrollTo({ top: 0, behavior: "auto" });
            });
        });
    }
}

function renderMessages() {
    const messages = sortedMessages(filteredMessages());
    const pageCount = Math.max(1, Math.ceil(messages.length / state.pageSize));
    state.page = Math.min(state.page, pageCount);
    const firstIndex = (state.page - 1) * state.pageSize;
    const pageMessages = messages.slice(firstIndex, firstIndex + state.pageSize);

    elements.content.replaceChildren();
    if (!pageMessages.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No messages match the current filter.";
        elements.content.append(empty);
    } else {
        const table = elements.tableTemplate.content.cloneNode(true);
        const body = table.querySelector("tbody");
        configureMessageSort(table);

        for (const message of pageMessages) {
            const row = document.createElement("tr");
            const numberCell = document.createElement("td");
            numberCell.append(previewTrigger(message, message.number));

            const dateCell = document.createElement("td");
            dateCell.textContent = new Date(message.date).toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
            });

            const fromCell = document.createElement("td");
            fromCell.append(senderCell(message));

            const subjectCell = document.createElement("td");
            subjectCell.append(previewTrigger(message, message.subject));
            const snippet = state.bodySearchSnippets.get(Number(message.number));
            if (state.searchBodies && snippet) {
                subjectCell.append(searchMatchSnippet(snippet, state.query.toLocaleLowerCase("en-US")));
            }

            row.append(numberCell, dateCell, fromCell, subjectCell);
            body.append(row);
            if (state.previewNumber === message.number) {
                body.append(messagePreviewRow(message));
            }
        }
        elements.content.append(table);
    }

    elements.pagination.hidden = messages.length <= state.pageSize;
    elements.pageStatus.textContent =
        `${messages.length.toLocaleString()} messages · Page ${state.page} of ${pageCount}`;
    elements.previous.disabled = state.page <= 1;
    elements.next.disabled = state.page >= pageCount;
    updateMessageCounter(messages.length);
    renderActiveFilter(messages.length);
}

function directoryButton(label, count, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "directory-button";
    const name = document.createElement("span");
    name.textContent = label;
    const total = document.createElement("span");
    total.className = "directory-count";
    total.textContent = count.toLocaleString();
    button.append(name, total);
    button.addEventListener("click", onClick);
    return button;
}

function renderDirectory(entries, toLabel, onSelect) {
    elements.content.replaceChildren();
    const grid = document.createElement("div");
    grid.className = "directory-grid";
    const query = state.query.toLocaleLowerCase("en-US");
    const visible = entries.filter((entry) =>
        !query || toLabel(entry).toLocaleLowerCase("en-US").includes(query)
    );
    for (const entry of visible) {
        grid.append(directoryButton(toLabel(entry), entry.count, () => onSelect(entry)));
    }
    if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No entries match the current search.";
        elements.content.append(empty);
    } else {
        elements.content.append(grid);
    }
    elements.pagination.hidden = true;
    elements.activeFilter.hidden = true;
}

function senderSortValue(sender, column) {
    if (column === "name") {
        return `${sender.name} ${sender.address || ""}`.toLocaleLowerCase("en-US");
    }
    if (column === "lastPosted") {
        return new Date(sender.lastPosted).getTime();
    }
    return sender.count;
}

function sortedSenders(senders) {
    const { column, direction } = state.senderSort;
    const multiplier = direction === "asc" ? 1 : -1;
    return [...senders].sort((left, right) => {
        const leftValue = senderSortValue(left, column);
        const rightValue = senderSortValue(right, column);
        let comparison;

        if (typeof leftValue === "string") {
            comparison = leftValue.localeCompare(rightValue);
        } else {
            comparison = leftValue - rightValue;
        }

        return comparison * multiplier || left.name.localeCompare(right.name);
    });
}

function senderSortButton(label, column) {
    const button = document.createElement("button");
    const active = state.senderSort.column === column;
    button.type = "button";
    button.className = "sort-button";
    button.textContent = `${label}${active ? (state.senderSort.direction === "asc" ? " ▲" : " ▼") : ""}`;
    button.addEventListener("click", () => {
        if (active) {
            state.senderSort.direction = state.senderSort.direction === "asc" ? "desc" : "asc";
        } else {
            state.senderSort.column = column;
            state.senderSort.direction = column === "name" ? "asc" : "desc";
        }
        renderSenders();
    });
    return button;
}

function renderSenders() {
    updateMessageCounter();
    elements.content.replaceChildren();
    const query = state.query.toLocaleLowerCase("en-US");
    const visible = state.senders.filter((sender) => {
        const label = `${sender.name} ${sender.address || ""}`.toLocaleLowerCase("en-US");
        return !query || label.includes(query);
    });

    if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No senders match the current search.";
        elements.content.append(empty);
    } else {
        const wrapper = document.createElement("div");
        wrapper.className = "table-wrap sender-table-wrap";
        const table = document.createElement("table");
        table.className = "sender-table";
        const head = document.createElement("thead");
        const headerRow = document.createElement("tr");

        for (const [label, column] of [
            ["Sender", "name"],
            ["Msgs", "count"],
            ["Last posted", "lastPosted"]
        ]) {
            const header = document.createElement("th");
            header.scope = "col";
            if (state.senderSort.column === column) {
                header.setAttribute("aria-sort", state.senderSort.direction === "asc" ? "ascending" : "descending");
            }
            header.append(senderSortButton(label, column));
            headerRow.append(header);
        }
        head.append(headerRow);

        const body = document.createElement("tbody");
        for (const sender of sortedSenders(visible)) {
            const row = document.createElement("tr");
            const senderColumn = document.createElement("td");
            const senderButton = document.createElement("button");
            senderButton.type = "button";
            senderButton.className = "sender-link";
            const name = document.createElement("span");
            name.textContent = sender.name;
            senderButton.append(name);
            if (sender.address) {
                const address = document.createElement("span");
                address.className = "sender-address";
                address.textContent = sender.address;
                senderButton.append(address);
            }
            senderButton.addEventListener("click", () => {
                location.hash = `sender=${encodeURIComponent(sender.key)}`;
            });
            senderColumn.append(senderButton);

            const countColumn = document.createElement("td");
            countColumn.className = "numeric-column";
            countColumn.textContent = sender.count.toLocaleString();

            const dateColumn = document.createElement("td");
            dateColumn.textContent = new Date(sender.lastPosted).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric"
            });
            row.append(senderColumn, countColumn, dateColumn);
            body.append(row);
        }

        table.append(head, body);
        wrapper.append(table);
        elements.content.append(wrapper);
    }

    elements.pagination.hidden = true;
    elements.activeFilter.hidden = true;
}

function renderTopics() {
    updateMessageCounter();
    elements.content.replaceChildren();
    const query = state.query.toLocaleLowerCase("en-US");
    const visible = state.topics.filter((topic) => {
        const searchable = `${topic.label} ${topic.category} ${topic.description}`
            .toLocaleLowerCase("en-US");
        return !query || searchable.includes(query);
    });

    if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No topics match the current search.";
        elements.content.append(empty);
    } else {
        const wrapper = document.createElement("div");
        wrapper.className = "table-wrap topic-table-wrap";
        const table = document.createElement("table");
        table.className = "topic-table";
        const head = document.createElement("thead");
        const headerRow = document.createElement("tr");

        for (const [label, column] of [
            ["Name", "name"],
            ["Category", "category"],
            ["Description", "description"],
            ["Messages", "count"],
            ["Last posted", "lastPosted"]
        ]) {
            const header = document.createElement("th");
            header.scope = "col";
            if (state.topicSort.column === column) {
                header.setAttribute(
                    "aria-sort",
                    state.topicSort.direction === "asc" ? "ascending" : "descending"
                );
            }
            header.append(topicSortButton(label, column));
            headerRow.append(header);
        }
        head.append(headerRow);

        const body = document.createElement("tbody");
        for (const topic of sortedTopics(visible)) {
            const row = document.createElement("tr");

            const nameColumn = document.createElement("td");
            const name = document.createElement("button");
            name.type = "button";
            name.className = "topic-link";
            name.textContent = topic.label;
            name.addEventListener("click", () => {
                state.query = "";
                elements.search.value = "";
                location.hash = `topic=${encodeURIComponent(topic.id)}`;
            });
            nameColumn.append(name);

            const categoryColumn = document.createElement("td");
            categoryColumn.textContent = topic.category;

            const descriptionColumn = document.createElement("td");
            descriptionColumn.className = "topic-description-column";
            descriptionColumn.textContent = topic.description;

            const countColumn = document.createElement("td");
            countColumn.className = "numeric-column";
            countColumn.textContent = topic.messageCount.toLocaleString();

            const dateColumn = document.createElement("td");
            dateColumn.textContent = new Date(topic.lastPosted).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric"
            });

            row.append(
                nameColumn,
                categoryColumn,
                descriptionColumn,
                countColumn,
                dateColumn
            );
            body.append(row);
        }

        table.append(head, body);
        wrapper.append(table);
        elements.content.append(wrapper);
    }

    elements.pagination.hidden = true;
    elements.activeFilter.hidden = true;
}

function topicSortValue(topic, column) {
    if (column === "name") {
        return topic.label.toLocaleLowerCase("en-US");
    }
    if (column === "count") {
        return topic.messageCount;
    }
    if (column === "lastPosted") {
        return new Date(topic.lastPosted).getTime();
    }
    return String(topic[column] || "").toLocaleLowerCase("en-US");
}

function sortedTopics(topics) {
    const { column, direction } = state.topicSort;
    const multiplier = direction === "asc" ? 1 : -1;
    return [...topics].sort((left, right) => {
        const leftValue = topicSortValue(left, column);
        const rightValue = topicSortValue(right, column);
        const comparison = typeof leftValue === "string"
            ? leftValue.localeCompare(rightValue)
            : leftValue - rightValue;
        return comparison * multiplier || left.label.localeCompare(right.label);
    });
}

function topicSortButton(label, column) {
    const button = document.createElement("button");
    const active = state.topicSort.column === column;
    button.type = "button";
    button.className = "sort-button";
    button.textContent = `${label}${active ? (state.topicSort.direction === "asc" ? " ▲" : " ▼") : ""}`;
    button.addEventListener("click", () => {
        if (active) {
            state.topicSort.direction = state.topicSort.direction === "asc" ? "desc" : "asc";
        } else {
            state.topicSort.column = column;
            state.topicSort.direction = ["count", "lastPosted"].includes(column)
                ? "desc"
                : "asc";
        }
        renderTopics();
    });
    return button;
}

function renderActiveFilter(messageCount) {
    elements.activeFilter.replaceChildren();
    if (!state.sender && !state.keyword && !state.topic) {
        elements.activeFilter.hidden = true;
        return;
    }

    const label = document.createElement("span");
    if (state.sender) {
        const sender = state.senders.find((entry) => entry.key === state.sender);
        label.textContent = `Sender: ${sender?.name || state.sender} · ${messageCount.toLocaleString()} messages`;
    } else if (state.keyword) {
        label.textContent = `Keyword: ${state.keyword} · ${messageCount.toLocaleString()} messages`;
    } else {
        const topic = state.topics.find((entry) => entry.id === state.topic);
        label.textContent = `Topic: ${topic?.label || state.topic} · ${messageCount.toLocaleString()} messages`;
    }

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "clear-filter";
    clear.textContent = "Clear filter";
    clear.addEventListener("click", () => {
        location.hash = "messages";
    });
    elements.activeFilter.append(label, clear);
    elements.activeFilter.hidden = false;
}

function render() {
    updateBodySearchControl();
    for (const tab of elements.tabs) {
        tab.classList.toggle("active", tab.dataset.view === state.view);
        tab.setAttribute("aria-pressed", String(tab.dataset.view === state.view));
    }

    if (state.view === "senders") {
        elements.search.placeholder = "Search sender name or address";
        renderSenders();
    } else if (state.view === "topics") {
        elements.search.placeholder = "Search topic name, category, or description";
        renderTopics();
    } else if (state.view === "keywords") {
        renderDirectory(
            state.keywords.map((keyword) => ({
                ...keyword,
                count: keyword.messageCount
            })),
            (keyword) => keyword.term,
            (keyword) => { location.hash = `keyword=${encodeURIComponent(keyword.term)}`; }
        );
    } else {
        elements.search.placeholder = state.searchBodies
            ? "Search number, sender, subject, or message text"
            : "Search message number, sender, or subject";
        renderMessages();
    }
}

async function loadArchive() {
    const [manifestResponse, messagesResponse, keywordsResponse, topicsResponse] = await Promise.all([
        fetch("data/manifest.json"),
        fetch("data/messages.json"),
        fetch("data/keywords.json"),
        fetch("data/topics.json")
    ]);
    if (![manifestResponse, messagesResponse, keywordsResponse, topicsResponse]
        .every((response) => response.ok)) {
        throw new Error("One or more archive data files could not be loaded.");
    }

    state.manifest = await manifestResponse.json();
    state.messages = await messagesResponse.json();
    state.keywords = await keywordsResponse.json();
    const topicCatalog = await topicsResponse.json();
    state.topics = topicCatalog.topics;
    state.senders = buildSenderDirectory(state.messages);
    elements.settingsArchiveSummary.textContent =
        `${state.manifest.messageCount.toLocaleString()} messages · ` +
        `${new Date(state.manifest.oldestDate).getFullYear()}–` +
        `${new Date(state.manifest.newestDate).getFullYear()}`;
    updateMessageCounter();
    parseHash();
    render();
}

elements.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    state.page = 1;
    state.previewNumber = null;
    searchMessageBodies();
    render();
});

elements.bodySearchButton.addEventListener("click", () => {
    state.searchBodies = !state.searchBodies;
    state.bodySearchMatches = new Set();
    state.bodySearchSnippets = new Map();
    bodySearchWork.generation += 1;
    setBodySearchProgress(false);
    state.page = 1;
    state.previewNumber = null;
    render();
    searchMessageBodies();
    elements.search.focus();
});

for (const tab of elements.tabs) {
    tab.addEventListener("click", () => {
        location.hash = tab.dataset.view;
    });
}

elements.previous.addEventListener("click", () => {
    state.page -= 1;
    state.previewNumber = null;
    renderMessages();
    scrollTo({ top: 0, behavior: "smooth" });
});

elements.next.addEventListener("click", () => {
    state.page += 1;
    state.previewNumber = null;
    renderMessages();
    scrollTo({ top: 0, behavior: "smooth" });
});

addEventListener("hashchange", () => {
    bodySearchWork.generation += 1;
    setBodySearchProgress(false);
    parseHash();
    render();
    scrollTo({ top: 0, behavior: "auto" });
});

elements.settingsButton.addEventListener("click", () => {
    elements.settingsDialog.showModal();
});

elements.themeSetting.addEventListener("change", () => {
    applyTheme(elements.themeSetting.value);
    saveSettings();
});

elements.pageSizeSetting.addEventListener("change", () => {
    state.pageSize = Number(elements.pageSizeSetting.value);
    state.page = 1;
    state.previewNumber = null;
    saveSettings();
    if (state.manifest) {
        render();
    }
});

elements.settingsDialog.addEventListener("click", (event) => {
    if (event.target === elements.settingsDialog) {
        elements.settingsDialog.close();
    }
});

function syncChromeHeight() {
    document.documentElement.style.setProperty(
        "--app-chrome-height",
        `${Math.ceil(elements.appChrome.getBoundingClientRect().height)}px`
    );
}

syncChromeHeight();
if ("ResizeObserver" in window) {
    new ResizeObserver(syncChromeHeight).observe(elements.appChrome);
} else {
    addEventListener("resize", syncChromeHeight);
}

loadSettings();
loadArchive().catch((error) => {
    console.error(error);
    elements.settingsArchiveSummary.textContent = "Archive data could not be loaded.";
    const message = document.createElement("p");
    message.className = "empty-state";
    message.textContent = `${error.message} Generate the static export before opening this page.`;
    elements.content.replaceChildren(message);
});
