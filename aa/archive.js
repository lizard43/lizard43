// Filename: archive.js
// Version: 20260913-210557

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
    previewAnchorNumber: null,
    searchBodies: true,
    bodySearchMatches: new Set(),
    bodySearchSnippets: new Map(),
    threaded: true,
    threadDataAvailable: false,
    messageByNumber: new Map(),
    threadMessages: new Map(),
    expandedThreads: new Set(),
    messageSort: {
        column: "date",
        direction: "desc"
    },
    threadSort: {
        column: "date",
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
    threadViewButton: document.querySelector("#threadViewButton"),
    bodySearchButton: document.querySelector("#bodySearchButton"),
    settingsButton: document.querySelector("#settingsButton"),
    settingsDialog: document.querySelector("#settingsDialog"),
    themeSetting: document.querySelector("#themeSetting"),
    pageSizeSetting: document.querySelector("#pageSizeSetting"),
    threadedSetting: document.querySelector("#threadedSetting"),
    bodySearchSetting: document.querySelector("#bodySearchSetting")
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
    state.threaded = settings.threaded !== false;
    state.searchBodies = settings.searchBodies !== false;
    elements.themeSetting.value = theme;
    elements.pageSizeSetting.value = String(pageSize);
    elements.threadedSetting.checked = state.threaded;
    elements.bodySearchSetting.checked = state.searchBodies;
    applyTheme(theme);
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
            theme: elements.themeSetting.value,
            pageSize: state.pageSize,
            threaded: state.threaded,
            searchBodies: state.searchBodies
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

function buildThreadIndex(messages) {
    state.messageByNumber = new Map();
    state.threadMessages = new Map();
    state.threadDataAvailable = messages.length > 0 &&
        messages.every((message) => Object.hasOwn(message, "threadRootNumber"));

    for (const message of messages) {
        message.number = Number(message.number);
        message.threadRootNumber = Number(message.threadRootNumber ?? message.number);
        message.parentNumber = message.parentNumber == null ? null : Number(message.parentNumber);
        state.messageByNumber.set(message.number, message);
        const thread = state.threadMessages.get(message.threadRootNumber) || [];
        thread.push(message);
        state.threadMessages.set(message.threadRootNumber, thread);
    }

    for (const thread of state.threadMessages.values()) {
        thread.sort((left, right) =>
            new Date(left.date).getTime() - new Date(right.date).getTime() ||
            left.number - right.number
        );
    }

    if (!state.threadDataAvailable) {
        state.threaded = false;
    }
}

function clearPreview() {
    state.previewNumber = null;
    state.previewAnchorNumber = null;
}

function parseHash() {
    const value = location.hash.replace(/^#/, "");
    const [kind, encodedValue] = value.split("=", 2);
    state.sender = null;
    state.keyword = null;
    state.topic = null;
    clearPreview();

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

function updateThreadViewControl() {
    const button = elements.threadViewButton;
    button.hidden = state.view !== "messages";
    button.disabled = !state.threadDataAvailable;
    button.classList.toggle("active", state.threaded && state.threadDataAvailable);
    button.setAttribute("aria-pressed", String(state.threaded && state.threadDataAvailable));
    const label = state.threadDataAvailable
        ? (state.threaded ? "Show flat message list" : "Group messages by thread")
        : "Run the updated site export to enable threads";
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

function messageIndicators({ messageCount = null, attachmentCount = 0, matchCount = null } = {}) {
    const indicators = document.createElement("span");
    indicators.className = "message-row-indicators";

    if (messageCount !== null) {
        const count = document.createElement("span");
        count.className = "thread-message-count";
        count.textContent = Number(messageCount).toLocaleString();
        count.setAttribute("aria-label", `${Number(messageCount).toLocaleString()} messages`);
        count.title = matchCount !== null && matchCount !== messageCount
            ? `${Number(matchCount).toLocaleString()} matching messages out of ${Number(messageCount).toLocaleString()}`
            : `${Number(messageCount).toLocaleString()} messages`;
        indicators.append(count);
    }

    if (attachmentCount > 0) {
        const clip = document.createElement("span");
        clip.className = "attachment-indicator";
        clip.setAttribute(
            "aria-label",
            `${Number(attachmentCount).toLocaleString()} ${attachmentCount === 1 ? "attachment" : "attachments"}`
        );
        clip.title = `${Number(attachmentCount).toLocaleString()} ${attachmentCount === 1 ? "attachment" : "attachments"}`;
        clip.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.5 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9"></path></svg>`;
        indicators.append(clip);
    }

    return indicators;
}

function senderCell(message, indicatorOptions = {}) {
    const wrapper = document.createElement("button");
    wrapper.type = "button";
    wrapper.className = "message-sender-link";
    const primary = document.createElement("span");
    primary.className = "message-sender-primary";
    const name = document.createElement("span");
    name.textContent = message.senderName || message.sender;
    primary.append(name);
    const indicators = messageIndicators(indicatorOptions);
    if (indicators.childElementCount) {
        primary.append(indicators);
    }
    wrapper.append(primary);
    if (message.senderAddress) {
        const address = document.createElement("span");
        address.className = "sender-address";
        address.textContent = message.senderAddress;
        wrapper.append(address);
    }
    wrapper.addEventListener("click", () => {
        state.query = "";
        elements.search.value = "";
        location.hash = `sender=${encodeURIComponent(message.senderKey)}`;
    });
    return wrapper;
}

function previewTrigger(message, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-link message-preview-trigger";
    button.textContent = label;
    button.setAttribute(
        "aria-expanded",
        String(state.previewAnchorNumber === message.number && state.previewNumber !== null)
    );
    button.addEventListener("click", () => {
        if (state.previewAnchorNumber === message.number && state.previewNumber !== null) {
            clearPreview();
        } else {
            state.previewAnchorNumber = message.number;
            state.previewNumber = message.number;
        }
        renderMessages();
    });
    return button;
}

function threadForMessage(message) {
    return state.threadMessages.get(message.threadRootNumber) || [message];
}

function threadNavigationButton(label, targetMessage) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preview-thread-button";
    button.textContent = label;
    button.disabled = !targetMessage;
    button.addEventListener("click", () => {
        if (!targetMessage) {
            return;
        }
        state.previewNumber = targetMessage.number;
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
    cell.colSpan = state.threaded && state.threadDataAvailable ? 3 : 4;

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

    const messageNumber = document.createElement("span");
    messageNumber.className = "preview-message-number";
    messageNumber.textContent = `Msg #${message.number}`;
    actions.append(open, messageNumber);

    const thread = threadForMessage(message);
    const threadIndex = thread.findIndex((entry) => entry.number === message.number);
    if (thread.length > 1 && threadIndex >= 0) {
        const navigation = document.createElement("div");
        navigation.className = "preview-thread-navigation";
        const previous = threadNavigationButton("← Previous", thread[threadIndex - 1]);
        const status = document.createElement("span");
        status.className = "preview-thread-status";
        status.textContent = `${threadIndex + 1} of ${thread.length}`;
        const next = threadNavigationButton("Next →", thread[threadIndex + 1]);
        navigation.append(previous, status, next);
        actions.append(navigation);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "close-preview-button";
    close.setAttribute("aria-label", "Close message preview");
    close.textContent = "×";
    close.addEventListener("click", () => {
        clearPreview();
        renderMessages();
    });
    actions.append(close);
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
        date: state.threaded ? "Posted" : "Date",
        sender: "Sender",
        subject: "Subject"
    };
    const sortState = state.threaded ? state.threadSort : state.messageSort;

    for (const button of table.querySelectorAll("[data-message-sort]")) {
        const column = button.dataset.messageSort;
        const active = sortState.column === column;
        button.textContent = `${labels[column]}${active
            ? (sortState.direction === "asc" ? " ▲" : " ▼")
            : ""}`;
        const header = button.closest("th");
        if (active) {
            header.setAttribute(
                "aria-sort",
                sortState.direction === "asc" ? "ascending" : "descending"
            );
        }
        button.addEventListener("click", () => {
            runBusy(() => {
                if (active) {
                    sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
                } else {
                    sortState.column = column;
                    sortState.direction = ["number", "date"].includes(column) ? "desc" : "asc";
                }
                state.page = 1;
                clearPreview();
                renderMessages();
                scrollTo({ top: 0, behavior: "auto" });
            });
        });
    }
}

function dateParts(date, includeTime = false) {
    const options = {
        year: "2-digit",
        month: "short",
        day: "2-digit"
    };
    if (includeTime) {
        options.hour = "2-digit";
        options.minute = "2-digit";
        options.hourCycle = "h23";
    }
    return new Map(
        new Intl.DateTimeFormat("en-US", options)
            .formatToParts(new Date(date))
            .map((part) => [part.type, part.value])
    );
}

function formatCalendarDate(date) {
    const parts = dateParts(date);
    return `${parts.get("day")} ${parts.get("month")} ${parts.get("year")}`;
}

function messageDateElement(date) {
    const parts = dateParts(date, true);
    const element = document.createElement("time");
    element.className = "message-date";
    element.dateTime = new Date(date).toISOString();

    const calendar = document.createElement("span");
    calendar.className = "message-date-calendar";
    calendar.textContent = `${parts.get("day")} ${parts.get("month")} ${parts.get("year")}`;

    const separator = document.createElement("span");
    separator.className = "message-date-separator";
    separator.textContent = " · ";

    const clock = document.createElement("span");
    clock.className = "message-date-clock";
    clock.textContent = `${parts.get("hour")}:${parts.get("minute")}`;
    element.append(calendar, separator, clock);
    return element;
}

function appendSearchSnippet(cell, message) {
    const snippet = state.bodySearchSnippets.get(Number(message.number));
    if (state.searchBodies && snippet) {
        cell.append(searchMatchSnippet(snippet, state.query.toLocaleLowerCase("en-US")));
    }
}

function createMessageRow(message, options = {}) {
    const row = document.createElement("tr");
    if (options.className) {
        row.className = options.className;
    }
    if (options.depth) {
        row.style.setProperty("--thread-depth", String(Math.min(options.depth, 4)));
    }
    if (options.dimmed) {
        row.classList.add("thread-nonmatch");
    }

    const dateCell = document.createElement("td");
    dateCell.append(messageDateElement(message.date));

    const fromCell = document.createElement("td");
    fromCell.append(senderCell(message, {
        attachmentCount: Number(message.attachments) || 0
    }));

    const subjectCell = document.createElement("td");
    subjectCell.append(previewTrigger(message, message.subject));
    if (options.depth) {
        subjectCell.classList.add("thread-child-subject");
    }
    appendSearchSnippet(subjectCell, message);

    row.append(dateCell, fromCell, subjectCell);
    return row;
}

function appendPreviewAfterAnchor(body, anchorMessage, threadSpan = false) {
    if (state.previewAnchorNumber !== anchorMessage.number || state.previewNumber === null) {
        return;
    }
    const previewMessage = state.messageByNumber.get(state.previewNumber);
    if (previewMessage) {
        const previewRow = messagePreviewRow(previewMessage);
        previewRow.classList.toggle("thread-span-row", threadSpan);
        body.append(previewRow);
    }
}

function renderFlatMessages() {
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
            const row = createMessageRow(message);
            body.append(row);
            appendPreviewAfterAnchor(body, message);
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

function threadDepth(message) {
    let depth = 0;
    let current = message;
    const visited = new Set([message.number]);
    while (current.parentNumber !== null && depth < 4) {
        const parent = state.messageByNumber.get(current.parentNumber);
        if (!parent || visited.has(parent.number)) {
            break;
        }
        visited.add(parent.number);
        depth += 1;
        current = parent;
    }
    return depth;
}

function filteredThreadEntries(messages) {
    const matchesByRoot = new Map();
    for (const message of messages) {
        const matches = matchesByRoot.get(message.threadRootNumber) || new Set();
        matches.add(message.number);
        matchesByRoot.set(message.threadRootNumber, matches);
    }

    return [...matchesByRoot.entries()].map(([rootNumber, matches]) => {
        const thread = state.threadMessages.get(rootNumber) || [];
        const root = state.messageByNumber.get(rootNumber) || thread[0];
        return {
            rootNumber,
            root,
            latest: thread[thread.length - 1] || root,
            messages: thread,
            matches
        };
    }).filter((entry) => entry.root);
}

function threadSortValue(thread, column) {
    if (column === "number") {
        return thread.rootNumber;
    }
    if (column === "date") {
        return new Date(thread.latest.date).getTime();
    }
    if (column === "sender") {
        return `${thread.root.senderName || thread.root.sender} ${thread.root.senderAddress || ""}`
            .toLocaleLowerCase("en-US");
    }
    return thread.root.subject.toLocaleLowerCase("en-US");
}

function sortedThreadEntries(threads) {
    const { column, direction } = state.threadSort;
    const multiplier = direction === "asc" ? 1 : -1;
    return [...threads].sort((left, right) => {
        const leftValue = threadSortValue(left, column);
        const rightValue = threadSortValue(right, column);
        const comparison = typeof leftValue === "string"
            ? leftValue.localeCompare(rightValue)
            : leftValue - rightValue;
        return comparison * multiplier || right.latest.number - left.latest.number;
    });
}

function threadSummaryRow(thread) {
    const row = document.createElement("tr");
    row.className = "thread-summary-row";
    const expanded = state.expandedThreads.has(thread.rootNumber);
    row.classList.toggle("thread-span-row", expanded);

    const dateCell = document.createElement("td");
    const dateLayout = document.createElement("span");
    dateLayout.className = "thread-date-layout";
    if (thread.messages.length > 1) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "thread-toggle";
        toggle.textContent = expanded ? "▾" : "▸";
        toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} thread ${thread.rootNumber}`);
        toggle.setAttribute("aria-expanded", String(expanded));
        toggle.addEventListener("click", () => {
            if (expanded) {
                state.expandedThreads.delete(thread.rootNumber);
            } else {
                state.expandedThreads.add(thread.rootNumber);
            }
            renderMessages();
        });
        dateLayout.append(toggle);
    } else {
        const spacer = document.createElement("span");
        spacer.className = "thread-toggle-spacer";
        dateLayout.append(spacer);
    }
    const date = document.createElement("span");
    date.append(messageDateElement(thread.latest.date));
    dateLayout.append(date);
    dateCell.append(dateLayout);

    const senderColumn = document.createElement("td");
    const attachmentCount = thread.messages.reduce(
        (total, message) => total + (Number(message.attachments) || 0),
        0
    );
    senderColumn.append(senderCell(thread.root, {
        messageCount: thread.messages.length,
        attachmentCount,
        matchCount: thread.matches.size
    }));

    const subjectCell = document.createElement("td");
    subjectCell.append(previewTrigger(thread.root, thread.root.subject));
    const snippetMessage = thread.messages.find((message) =>
        thread.matches.has(message.number) &&
        state.bodySearchSnippets.has(message.number)
    );
    if (snippetMessage) {
        const snippet = searchMatchSnippet(
            state.bodySearchSnippets.get(snippetMessage.number),
            state.query.toLocaleLowerCase("en-US")
        );
        if (snippetMessage.number !== thread.root.number) {
            snippet.prepend(document.createTextNode(`#${snippetMessage.number}: `));
        }
        subjectCell.append(snippet);
    }

    row.append(dateCell, senderColumn, subjectCell);
    return row;
}

function renderThreadedMessages() {
    const matchingMessages = filteredMessages();
    const threads = sortedThreadEntries(filteredThreadEntries(matchingMessages));
    const pageCount = Math.max(1, Math.ceil(threads.length / state.pageSize));
    state.page = Math.min(state.page, pageCount);
    const firstIndex = (state.page - 1) * state.pageSize;
    const pageThreads = threads.slice(firstIndex, firstIndex + state.pageSize);

    elements.content.replaceChildren();
    if (!pageThreads.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No threads match the current filter.";
        elements.content.append(empty);
    } else {
        const tableFragment = elements.tableTemplate.content.cloneNode(true);
        const table = tableFragment.querySelector("table");
        const body = tableFragment.querySelector("tbody");
        table.classList.add("threaded-table");
        configureMessageSort(tableFragment);

        for (const thread of pageThreads) {
            const expanded = state.expandedThreads.has(thread.rootNumber);
            const summary = threadSummaryRow(thread);
            body.append(summary);
            appendPreviewAfterAnchor(body, thread.root, expanded);
            if (!expanded) {
                continue;
            }
            for (const message of thread.messages) {
                if (message.number === thread.root.number) {
                    continue;
                }
                const row = createMessageRow(message, {
                    className: "thread-message-row thread-span-row",
                    depth: threadDepth(message),
                    dimmed: thread.matches.size !== thread.messages.length &&
                        !thread.matches.has(message.number)
                });
                body.append(row);
                appendPreviewAfterAnchor(body, message, true);
            }
        }
        elements.content.append(tableFragment);
    }

    elements.pagination.hidden = threads.length <= state.pageSize;
    elements.pageStatus.textContent =
        `${threads.length.toLocaleString()} threads · ` +
        `${matchingMessages.length.toLocaleString()} messages · ` +
        `Page ${state.page} of ${pageCount}`;
    elements.previous.disabled = state.page <= 1;
    elements.next.disabled = state.page >= pageCount;
    updateMessageCounter(matchingMessages.length);
    renderActiveFilter(matchingMessages.length);
}

function renderMessages() {
    if (state.threaded && state.threadDataAvailable) {
        renderThreadedMessages();
    } else {
        renderFlatMessages();
    }
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
            ["Posted", "lastPosted"]
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
            dateColumn.textContent = formatCalendarDate(sender.lastPosted);
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
            ["Desc", "description"],
            ["Messages", "count"],
            ["Posted", "lastPosted"]
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
            dateColumn.textContent = formatCalendarDate(topic.lastPosted);

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
        location.hash = state.topic ? "topics" : "messages";
    });
    elements.activeFilter.append(label, clear);
    elements.activeFilter.hidden = false;
}

function render() {
    updateBodySearchControl();
    updateThreadViewControl();
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
    buildThreadIndex(state.messages);
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
    clearPreview();
    searchMessageBodies();
    render();
});

elements.threadViewButton.addEventListener("click", () => {
    if (!state.threadDataAvailable) {
        return;
    }
    state.threaded = !state.threaded;
    elements.threadedSetting.checked = state.threaded;
    state.page = 1;
    clearPreview();
    saveSettings();
    render();
    scrollTo({ top: 0, behavior: "auto" });
});

elements.bodySearchButton.addEventListener("click", () => {
    state.searchBodies = !state.searchBodies;
    elements.bodySearchSetting.checked = state.searchBodies;
    state.bodySearchMatches = new Set();
    state.bodySearchSnippets = new Map();
    bodySearchWork.generation += 1;
    setBodySearchProgress(false);
    state.page = 1;
    clearPreview();
    saveSettings();
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
    clearPreview();
    renderMessages();
    scrollTo({ top: 0, behavior: "smooth" });
});

elements.next.addEventListener("click", () => {
    state.page += 1;
    clearPreview();
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
    clearPreview();
    saveSettings();
    if (state.manifest) {
        render();
    }
});

elements.threadedSetting.addEventListener("change", () => {
    state.threaded = elements.threadedSetting.checked;
    state.page = 1;
    clearPreview();
    saveSettings();
    if (state.manifest) {
        render();
    }
});

elements.bodySearchSetting.addEventListener("change", () => {
    state.searchBodies = elements.bodySearchSetting.checked;
    state.bodySearchMatches = new Set();
    state.bodySearchSnippets = new Map();
    bodySearchWork.generation += 1;
    setBodySearchProgress(false);
    state.page = 1;
    clearPreview();
    saveSettings();
    if (state.manifest) {
        render();
        searchMessageBodies();
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
