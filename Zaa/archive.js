// Filename: archive.js
// Version: 20260921-entity-navigation

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
const readerNavigation = {
    loadGeneration: 0,
    touchStartY: null,
    touchBoundary: null,
    touchNavigated: false,
    lockedUntil: 0
};
const state = {
    manifest: null,
    messages: [],
    keywords: [],
    topics: [],
    people: [],
    organizations: [],
    projects: [],
    relationships: [],
    personBySenderKey: new Map(),
    senders: [],
    view: "messages",
    query: "",
    sender: null,
    keyword: null,
    topic: null,
    personFilter: null,
    personFilterType: null,
    expandedPerson: null,
    peopleEntityFilter: null,
    previewNumber: null,
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
    pageSizeSetting: document.querySelector("#pageSizeSetting"),
    threadedSetting: document.querySelector("#threadedSetting"),
    bodySearchSetting: document.querySelector("#bodySearchSetting"),
    messageDialog: document.querySelector("#messageDialog"),
    messageDialogSubject: document.querySelector("#messageDialogSubject"),
    messageDialogSender: document.querySelector("#messageDialogSender"),
    messageDialogDate: document.querySelector("#messageDialogDate"),
    messageDialogNumber: document.querySelector("#messageDialogNumber"),
    messageDialogOpen: document.querySelector("#messageDialogOpen"),
    messageDialogPrevious: document.querySelector("#messageDialogPrevious"),
    messageDialogThreadStatus: document.querySelector("#messageDialogThreadStatus"),
    messageDialogNext: document.querySelector("#messageDialogNext"),
    messageDialogClose: document.querySelector("#messageDialogClose"),
    messageDialogBody: document.querySelector("#messageDialogBody"),
    messageDialogText: document.querySelector("#messageDialogText"),
    messageDialogBoundary: document.querySelector("#messageDialogBoundary")
};

function loadSettings() {
    let settings = {};
    try {
        settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    } catch {
        settings = {};
    }

    const pageSize = [50, 100, 200].includes(Number(settings.pageSize))
        ? Number(settings.pageSize)
        : DEFAULT_PAGE_SIZE;

    state.pageSize = pageSize;
    state.threaded = settings.threaded !== false;
    state.searchBodies = settings.searchBodies !== false;
    elements.pageSizeSetting.value = String(pageSize);
    elements.threadedSetting.checked = state.threaded;
    elements.bodySearchSetting.checked = state.searchBodies;
}

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
            pageSize: state.pageSize,
            threaded: state.threaded,
            searchBodies: state.searchBodies
        }));
    } catch {
        // Browser privacy settings may disable local storage.
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

function buildPeopleSenderIndex() {
    state.personBySenderKey = new Map();
    for (const person of state.people) {
        for (const senderKey of person.senderKeys || []) {
            state.personBySenderKey.set(senderKey, person);
        }
    }
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
    readerNavigation.loadGeneration += 1;
    hideReaderBoundaryHint();
    if (elements.messageDialog.open) {
        elements.messageDialog.close();
    }
    updatePreviewTriggers();
}

function parseHash() {
    const value = location.hash.replace(/^#/, "");
    const [kind, encodedValue] = value.split("=", 2);
    state.sender = null;
    state.keyword = null;
    state.topic = null;
    state.personFilter = null;
    state.personFilterType = null;
    state.expandedPerson = null;
    state.peopleEntityFilter = null;
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
    } else if (["person-authored", "person-mentions", "person-related"].includes(kind) && encodedValue) {
        state.view = "messages";
        state.personFilter = decodeURIComponent(encodedValue);
        state.personFilterType = kind === "person-authored" ? "authored" : "mentions";
    } else if (kind === "people") {
        state.view = "people";
        state.expandedPerson = encodedValue ? decodeURIComponent(encodedValue) : null;
    } else if (["people-organization", "people-project"].includes(kind) && encodedValue) {
        state.view = "people";
        state.peopleEntityFilter = {
            type: kind === "people-organization" ? "organization" : "project",
            id: decodeURIComponent(encodedValue)
        };
    } else if (["messages", "senders", "topics", "people", "keywords"].includes(kind)) {
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

    if (state.personFilter) {
        const person = state.people.find((entry) => entry.id === state.personFilter);
        if (state.personFilterType === "authored") {
            const senderKeys = new Set(person?.senderKeys || []);
            messages = messages.filter((message) => senderKeys.has(message.senderKey));
        } else {
            const topic = state.topics.find((entry) => entry.id === person?.topicId);
            const messageNumbers = new Set(topic?.messages || []);
            const senderKeys = new Set(person?.senderKeys || []);
            messages = messages.filter((message) =>
                messageNumbers.has(message.number) && !senderKeys.has(message.senderKey)
            );
        }
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

function personIndicator(senderKey) {
    const person = state.personBySenderKey.get(senderKey);
    if (!person) {
        return null;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "person-indicator";
    button.textContent = "★";
    button.setAttribute("aria-label", `Open the ${person.name} profile`);
    button.title = `Featured person: ${person.name}`;
    button.addEventListener("click", () => {
        state.query = "";
        elements.search.value = "";
        location.hash = `people=${encodeURIComponent(person.id)}`;
    });
    return button;
}

function senderCell(message) {
    const container = document.createElement("span");
    container.className = "sender-with-profile";
    const wrapper = document.createElement("button");
    wrapper.type = "button";
    wrapper.className = "message-sender-link";
    const name = document.createElement("span");
    name.textContent = message.senderName || message.sender;
    wrapper.append(name);
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
    container.append(wrapper);
    const indicator = personIndicator(message.senderKey);
    if (indicator) {
        container.append(indicator);
    }
    return container;
}

function previewTrigger(message, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-link message-preview-trigger";
    button.textContent = label;
    button.dataset.messageNumber = String(message.number);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", String(state.previewNumber === message.number));
    button.addEventListener("click", () => {
        if (elements.messageDialog.open && state.previewNumber === message.number) {
            clearPreview();
        } else {
            openMessageReader(message);
        }
    });
    return button;
}

function threadForMessage(message) {
    return state.threadMessages.get(message.threadRootNumber) || [message];
}

async function messageBody(message) {
    try {
        const bodies = await fetchBodyChunk(message.bodyChunk);
        return bodies[message.number] || "This message has no text body.";
    } catch (error) {
        bodyChunkCache.delete(message.bodyChunk);
        return `${error.message} Run npm run export to generate message data.`;
    }
}

function readerThreadPosition(message) {
    if (!message) {
        return { thread: [], index: -1, previous: null, next: null };
    }
    const thread = threadForMessage(message);
    const threadIndex = thread.findIndex((entry) => entry.number === message.number);
    return {
        thread,
        index: threadIndex,
        previous: threadIndex > 0 ? thread[threadIndex - 1] : null,
        next: threadIndex >= 0 && threadIndex < thread.length - 1
            ? thread[threadIndex + 1]
            : null
    };
}

function updatePreviewTriggers() {
    for (const trigger of document.querySelectorAll("[data-message-number]")) {
        trigger.setAttribute(
            "aria-expanded",
            String(elements.messageDialog.open && Number(trigger.dataset.messageNumber) === state.previewNumber)
        );
    }
}

function hideReaderBoundaryHint() {
    if (!elements.messageDialogBoundary) {
        return;
    }
    elements.messageDialogBoundary.hidden = true;
    elements.messageDialogBoundary.classList.remove("at-top", "at-bottom");
}

function showReaderBoundaryHint(direction) {
    const position = readerThreadPosition(state.messageByNumber.get(state.previewNumber));
    const target = direction === "previous" ? position.previous : position.next;
    if (!target) {
        hideReaderBoundaryHint();
        return;
    }
    elements.messageDialogBoundary.textContent = direction === "previous"
        ? "Scroll again for the previous message"
        : "Scroll again for the next message";
    elements.messageDialogBoundary.classList.toggle("at-top", direction === "previous");
    elements.messageDialogBoundary.classList.toggle("at-bottom", direction === "next");
    elements.messageDialogBoundary.hidden = false;
}

function updateReaderBoundaryHint() {
    const body = elements.messageDialogBody;
    const atTop = body.scrollTop <= 1;
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
    const position = readerThreadPosition(state.messageByNumber.get(state.previewNumber));
    if (atTop && atBottom && (position.previous || position.next)) {
        elements.messageDialogBoundary.textContent = "Scroll past an edge to move through this thread";
        elements.messageDialogBoundary.classList.remove("at-top", "at-bottom");
        elements.messageDialogBoundary.hidden = false;
    } else if (atBottom && position.next) {
        showReaderBoundaryHint("next");
    } else if (atTop && position.previous) {
        showReaderBoundaryHint("previous");
    } else {
        hideReaderBoundaryHint();
    }
}

async function openMessageReader(message, scrollPosition = "top") {
    const generation = ++readerNavigation.loadGeneration;
    state.previewNumber = message.number;
    const position = readerThreadPosition(message);

    elements.messageDialogSubject.textContent = message.subject;
    elements.messageDialogSender.replaceChildren();
    const senderName = document.createElement("span");
    senderName.textContent = message.senderName || message.sender;
    elements.messageDialogSender.append(senderName);
    if (message.senderAddress) {
        const address = document.createElement("span");
        address.textContent = message.senderAddress;
        elements.messageDialogSender.append(address);
    }
    const date = messageDateElement(message.date);
    elements.messageDialogDate.className = date.className;
    elements.messageDialogDate.dateTime = date.dateTime;
    elements.messageDialogDate.replaceChildren(...date.childNodes);
    elements.messageDialogNumber.textContent = `Msg #${message.number}`;
    elements.messageDialogOpen.href = message.url;
    elements.messageDialogPrevious.disabled = !position.previous;
    elements.messageDialogNext.disabled = !position.next;
    elements.messageDialogThreadStatus.textContent =
        `${position.index + 1} of ${position.thread.length}`;
    elements.messageDialogText.textContent = "Loading message…";
    hideReaderBoundaryHint();

    if (!elements.messageDialog.open) {
        syncChromeHeight();
        elements.messageDialog.showModal();
        document.documentElement.classList.add("message-reader-open");
    }
    updatePreviewTriggers();

    const body = await messageBody(message);
    if (generation !== readerNavigation.loadGeneration || state.previewNumber !== message.number) {
        return;
    }
    elements.messageDialogText.textContent = body;
    requestAnimationFrame(() => {
        elements.messageDialogBody.scrollTop = scrollPosition === "bottom"
            ? elements.messageDialogBody.scrollHeight
            : 0;
        updateReaderBoundaryHint();
        elements.messageDialogBody.focus({ preventScroll: true });
    });
}

function navigateMessageReader(direction) {
    if (performance.now() < readerNavigation.lockedUntil) {
        return;
    }
    const message = state.messageByNumber.get(state.previewNumber);
    if (!message) {
        return;
    }
    const position = readerThreadPosition(message);
    const target = direction === "previous" ? position.previous : position.next;
    if (target) {
        readerNavigation.lockedUntil = performance.now() + 450;
        openMessageReader(target, direction === "previous" ? "bottom" : "top");
    }
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
        return;
    }
    const mentionSnippet = personMentionSnippet(message);
    if (mentionSnippet) {
        cell.append(mentionSnippet);
    }
}

function personMentionContext(message) {
    if (state.personFilterType !== "mentions" || !state.personFilter) {
        return null;
    }
    const person = state.people.find((entry) => entry.id === state.personFilter);
    const topic = state.topics.find((entry) => entry.id === person?.topicId);
    return topic?.messageContexts?.[message.number] || null;
}

function personMentionSnippet(message, includeNumber = false) {
    const context = personMentionContext(message);
    if (!context) {
        return null;
    }
    const term = context.term || "name";
    const text = context.excerpt || `Matched “${term}” in the subject.`;
    const snippet = searchMatchSnippet(text, term.toLocaleLowerCase("en-US"));
    if (includeNumber) {
        snippet.prepend(document.createTextNode(`#${message.number}: `));
    }
    return snippet;
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
    fromCell.append(senderCell(message));

    const subjectCell = document.createElement("td");
    subjectCell.append(previewTrigger(message, message.subject));
    const indicators = messageIndicators({
        attachmentCount: Number(message.attachments) || 0
    });
    if (indicators.childElementCount) {
        subjectCell.append(indicators);
    }
    if (options.depth) {
        subjectCell.classList.add("thread-child-subject");
    }
    appendSearchSnippet(subjectCell, message);

    row.append(dateCell, fromCell, subjectCell);
    return row;
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
    senderColumn.append(senderCell(thread.root));

    const subjectCell = document.createElement("td");
    const mentionMessage = state.personFilterType === "mentions"
        ? [...thread.messages].reverse().find((message) => thread.matches.has(message.number))
        : null;
    subjectCell.append(previewTrigger(mentionMessage || thread.root, thread.root.subject));
    const indicators = messageIndicators({
        messageCount: thread.messages.length,
        attachmentCount,
        matchCount: thread.matches.size
    });
    if (indicators.childElementCount) {
        subjectCell.append(indicators);
    }
    const searchSnippetMessage = thread.messages.find((message) =>
        thread.matches.has(message.number) &&
        state.bodySearchSnippets.has(message.number)
    );
    if (searchSnippetMessage) {
        const snippet = searchMatchSnippet(
            state.bodySearchSnippets.get(searchSnippetMessage.number),
            state.query.toLocaleLowerCase("en-US")
        );
        if (searchSnippetMessage.number !== thread.root.number) {
            snippet.prepend(document.createTextNode(`#${searchSnippetMessage.number}: `));
        }
        subjectCell.append(snippet);
    } else if (mentionMessage) {
        const snippet = personMentionSnippet(
            mentionMessage,
            mentionMessage.number !== thread.root.number
        );
        if (snippet) subjectCell.append(snippet);
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
            const senderWithProfile = document.createElement("span");
            senderWithProfile.className = "sender-with-profile";
            senderWithProfile.append(senderButton);
            const indicator = personIndicator(sender.key);
            if (indicator) {
                senderWithProfile.append(indicator);
            }
            senderColumn.append(senderWithProfile);

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

function personMessageButton(person, type) {
    const count = type === "authored"
        ? person.authoredMessageCount
        : person.mentionMessageCount;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "person-message-button";

    const total = document.createElement("strong");
    total.textContent = Number(count || 0).toLocaleString();
    const label = document.createElement("span");
    label.textContent = type === "authored" ? "Authored messages" : "Mentions by others";
    button.append(total, label);
    button.disabled = !count;
    button.addEventListener("click", () => {
        state.query = "";
        elements.search.value = "";
        location.hash = `${type === "authored" ? "person-authored" : "person-mentions"}=${encodeURIComponent(person.id)}`;
    });
    return button;
}

function profileTopicAnchor(topic, label = topic.label) {
    const link = document.createElement("a");
    link.className = "profile-topic-link";
    link.href = `#topic=${encodeURIComponent(topic.id)}`;
    link.textContent = label;
    return link;
}

function personRelatedTopics(person) {
    return (person.relatedTopicIds || [])
        .map((id) => state.topics.find((topic) => topic.id === id))
        .filter(Boolean);
}

function profileLinkTerms(person) {
    const terms = new Map();
    for (const topic of personRelatedTopics(person)) {
        for (const term of [topic.label, ...(topic.terms || []), ...(topic.aliases || [])]) {
            const normalized = String(term || "").normalize("NFKC").trim();
            if (normalized) terms.set(normalized.toLocaleLowerCase("en-US"), topic);
        }
    }
    return [...terms.entries()].sort((left, right) => right[0].length - left[0].length);
}

function appendLinkedProfileText(container, text, person) {
    const terms = profileLinkTerms(person);
    if (!terms.length) {
        container.textContent = text;
        return;
    }
    const topicByTerm = new Map(terms);
    const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])(${terms
            .map(([term]) => term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"))
            .join("|")})(?![\\p{L}\\p{N}])`,
        "giu"
    );
    let offset = 0;
    for (const match of String(text).matchAll(pattern)) {
        container.append(document.createTextNode(text.slice(offset, match.index)));
        const topic = topicByTerm.get(match[0].toLocaleLowerCase("en-US"));
        container.append(profileTopicAnchor(topic, match[0]));
        offset = match.index + match[0].length;
    }
    container.append(document.createTextNode(text.slice(offset)));
}

function renderPersonTopics(person) {
    const topics = personRelatedTopics(person);
    if (!topics.length) return null;
    const section = document.createElement("section");
    section.className = "person-related-topics";
    const heading = document.createElement("h3");
    heading.textContent = "Related topics";
    const links = document.createElement("div");
    links.className = "person-topic-links";
    for (const topic of topics) links.append(profileTopicAnchor(topic));
    section.append(heading, links);
    return section;
}

function renderPersonSources(sources) {
    const list = document.createElement("ul");
    list.className = "person-sources";
    for (const source of sources || []) {
        const url = typeof source === "string" ? source : source.url;
        const label = typeof source === "string" ? source : (source.label || source.url);
        if (!url) {
            continue;
        }
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = label;
        item.append(link);
        list.append(item);
    }
    return list;
}

function escapeRegularExpression(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function profilePersonAnchor(person, label = person.name) {
    const link = document.createElement("a");
    link.className = "profile-person-link";
    link.href = `#people=${encodeURIComponent(person.id)}`;
    link.textContent = label;
    return link;
}

function profileEntityAnchor(entity, type) {
    const link = document.createElement("a");
    link.className = "profile-entity-link";
    link.href = `#people-${type}=${encodeURIComponent(entity.id)}`;
    link.textContent = entity.name;
    return link;
}

function relationshipEntities(relationship, type) {
    const collection = type === "organization" ? state.organizations : state.projects;
    const ids = type === "organization"
        ? relationship.organizationIds || []
        : relationship.projectIds || [];
    return ids.map((id) => collection.find((entry) => entry.id === id) || { id, name: id });
}

function relationshipsForEntity(type, id) {
    const field = type === "organization" ? "organizationIds" : "projectIds";
    return state.relationships.filter((relationship) => (relationship[field] || []).includes(id));
}

function entityTopic(entity) {
    return state.topics.find((topic) => topic.id === (entity.topicId || entity.id)) || null;
}

function renderPeopleEntityFocus() {
    const filter = state.peopleEntityFilter;
    if (!filter) return null;
    const collection = filter.type === "organization" ? state.organizations : state.projects;
    const entity = collection.find((entry) => entry.id === filter.id);
    if (!entity) return null;
    const relationships = relationshipsForEntity(filter.type, filter.id);
    const peopleIds = new Set(relationships.flatMap((relationship) =>
        (relationship.participants || []).map((participant) => participant.personId).filter(Boolean)
    ));
    const panel = document.createElement("section");
    panel.className = "people-entity-focus";
    const heading = document.createElement("div");
    heading.className = "people-entity-focus-heading";
    const titleGroup = document.createElement("div");
    const type = document.createElement("span");
    type.className = "people-entity-type";
    type.textContent = filter.type;
    const title = document.createElement("h2");
    title.textContent = entity.name;
    titleGroup.append(type, title);
    const clear = document.createElement("a");
    clear.className = "people-entity-clear";
    clear.href = "#people";
    clear.textContent = "All people";
    heading.append(titleGroup, clear);
    const summary = document.createElement("p");
    summary.textContent = `${peopleIds.size.toLocaleString()} connected people · ` +
        `${relationships.length.toLocaleString()} documented relationships`;
    panel.append(heading, summary);
    const topic = entityTopic(entity);
    if (topic?.messageCount) {
        const messages = profileTopicAnchor(topic, `${topic.messageCount.toLocaleString()} related messages`);
        messages.classList.add("people-entity-messages");
        panel.append(messages);
    }
    return panel;
}

function appendLinkedPeopleText(container, text, currentPerson) {
    const personByName = new Map();
    for (const person of state.people) {
        if (person.id === currentPerson.id) continue;
        for (const name of [person.name, ...(person.aliases || [])]) {
            if (name) personByName.set(name.toLocaleLowerCase("en-US"), person);
        }
    }
    const names = [...personByName.keys()].sort((left, right) => right.length - left.length);
    if (!names.length) {
        container.textContent = text;
        return;
    }
    const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])(${names.map(escapeRegularExpression).join("|")})(?![\\p{L}\\p{N}])`,
        "giu"
    );
    let offset = 0;
    for (const match of String(text).matchAll(pattern)) {
        container.append(document.createTextNode(text.slice(offset, match.index)));
        const person = personByName.get(match[0].toLocaleLowerCase("en-US"));
        container.append(profilePersonAnchor(person, match[0]));
        offset = match.index + match[0].length;
    }
    container.append(document.createTextNode(text.slice(offset)));
}

function renderPersonConnections(person) {
    const relationships = state.relationships.filter((relationship) =>
        (relationship.participants || []).some((participant) => participant.personId === person.id)
    );
    if (!relationships.length) {
        return null;
    }

    const section = document.createElement("section");
    section.className = "person-connections";
    const heading = document.createElement("h3");
    heading.textContent = "Work and collaborators";
    const list = document.createElement("div");
    list.className = "person-connections-list";
    for (const relationship of relationships) {
        const item = document.createElement("article");
        item.className = "person-connection";
        const organizations = relationshipEntities(relationship, "organization")
            .filter((entry) => entry.name.toLocaleLowerCase("en-US") !==
                String(relationship.label || "").toLocaleLowerCase("en-US"));
        const projects = relationshipEntities(relationship, "project");
        const title = document.createElement("h4");
        title.textContent = relationship.label || "Documented connection";
        item.append(title);
        if (relationship.period || organizations.length || projects.length) {
            const metadata = document.createElement("span");
            metadata.className = "person-connection-metadata";
            const groups = [];
            if (relationship.period) groups.push(document.createTextNode(relationship.period));
            if (organizations.length) {
                const group = document.createDocumentFragment();
                organizations.forEach((organization, index) => {
                    if (index) group.append(document.createTextNode(", "));
                    group.append(profileEntityAnchor(organization, "organization"));
                });
                groups.push(group);
            }
            if (projects.length) {
                const group = document.createDocumentFragment();
                projects.forEach((project, index) => {
                    if (index) group.append(document.createTextNode(", "));
                    group.append(profileEntityAnchor(project, "project"));
                });
                groups.push(group);
            }
            groups.forEach((group, index) => {
                if (index) metadata.append(document.createTextNode(" · "));
                metadata.append(group);
            });
            item.append(metadata);
        }
        if (relationship.description) {
            const description = document.createElement("p");
            description.className = "person-connection-description";
            appendLinkedPeopleText(description, relationship.description, person);
            item.append(description);
        }
        if (relationship.sources?.length) {
            const sources = document.createElement("p");
            sources.className = "person-connection-sources";
            relationship.sources.forEach((source, index) => {
                if (index) sources.append(document.createTextNode(" · "));
                const url = typeof source === "string" ? source : source.url;
                const label = typeof source === "string" ? source : (source.label || source.url);
                const link = document.createElement("a");
                link.href = url;
                link.target = "_blank";
                link.rel = "noopener";
                link.textContent = label;
                sources.append(link);
            });
            item.append(sources);
        }
        list.append(item);
    }
    section.append(heading, list);
    return section;
}

function renderPeople() {
    updateMessageCounter();
    elements.content.replaceChildren();
    const entityRelationships = state.peopleEntityFilter
        ? relationshipsForEntity(state.peopleEntityFilter.type, state.peopleEntityFilter.id)
        : [];
    const entityPeople = new Set(entityRelationships.flatMap((relationship) =>
        (relationship.participants || []).map((participant) => participant.personId).filter(Boolean)
    ));
    const query = state.query.toLocaleLowerCase("en-US");
    const visible = state.people.filter((person) => {
        const searchable = [
            person.name,
            ...(person.aliases || []),
            person.astrocadeRole,
            person.astrocadeSummary,
            person.laterCareerSummary,
            person.industrySummary,
            ...(person.accomplishments || [])
        ].join(" ").toLocaleLowerCase("en-US");
        return (!state.peopleEntityFilter || entityPeople.has(person.id)) &&
            (!query || searchable.includes(query));
    });

    const entityFocus = renderPeopleEntityFocus();
    if (entityFocus) elements.content.append(entityFocus);

    if (!visible.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = state.people.length
            ? "No people match the current search."
            : "No people profiles are available. Run npm run people to build the catalog.";
        elements.content.append(empty);
    } else {
        const directory = document.createElement("div");
        directory.className = "people-directory";
        for (const person of visible) {
            const expanded = state.expandedPerson === person.id;
            const card = document.createElement("article");
            card.className = "person-card";
            card.dataset.personId = person.id;
            card.classList.toggle("expanded", expanded);

            const header = document.createElement("header");
            header.className = "person-card-header";
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "person-card-toggle";
            toggle.setAttribute("aria-expanded", String(expanded));
            toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Open"} ${person.name} profile`);
            toggle.addEventListener("click", () => {
                state.expandedPerson = expanded ? null : person.id;
                history.replaceState(
                    null,
                    "",
                    state.expandedPerson
                        ? `#people=${encodeURIComponent(state.expandedPerson)}`
                        : "#people"
                );
                renderPeople();
                requestAnimationFrame(() => {
                    document.querySelector(`[data-person-id="${CSS.escape(person.id)}"]`)
                        ?.scrollIntoView({ block: "nearest" });
                });
            });

            const summary = document.createElement("span");
            summary.className = "person-card-summary";
            const name = document.createElement("h2");
            name.textContent = person.name;
            const role = document.createElement("p");
            role.className = "person-role";
            role.textContent = person.astrocadeRole || "Identity and history review pending.";
            summary.append(name, role);

            const counts = document.createElement("span");
            counts.className = "person-card-counts";
            counts.textContent =
                `${Number(person.authoredMessageCount || 0).toLocaleString()} authored · ` +
                `${Number(person.mentionMessageCount || 0).toLocaleString()} mentions`;
            const chevron = document.createElement("span");
            chevron.className = "person-card-chevron";
            chevron.textContent = expanded ? "▾" : "▸";
            toggle.append(summary, counts, chevron);
            header.append(toggle);
            card.append(header);

            if (!expanded) {
                directory.append(card);
                continue;
            }

            const actions = document.createElement("div");
            actions.className = "person-message-actions";
            actions.append(
                personMessageButton(person, "authored"),
                personMessageButton(person, "mentions")
            );

            const details = document.createElement("div");
            details.className = "person-card-details";
            details.append(actions);
            const relatedTopics = renderPersonTopics(person);
            if (relatedTopics) {
                details.append(relatedTopics);
            }

            if (person.astrocadeSummary) {
                const astrocadeHeading = document.createElement("h3");
                astrocadeHeading.textContent = "Astrocade and early computing";
                const astrocade = document.createElement("p");
                appendLinkedProfileText(astrocade, person.astrocadeSummary, person);
                details.append(astrocadeHeading, astrocade);
            }
            const connections = renderPersonConnections(person);
            if (connections) {
                details.append(connections);
            }

            if (person.accomplishments?.length) {
                const accomplishmentsHeading = document.createElement("h3");
                accomplishmentsHeading.textContent = "Selected accomplishments";
                const accomplishments = document.createElement("ul");
                accomplishments.className = "person-accomplishments";
                for (const accomplishment of person.accomplishments) {
                    const item = document.createElement("li");
                    appendLinkedProfileText(item, accomplishment, person);
                    accomplishments.append(item);
                }
                details.append(accomplishmentsHeading, accomplishments);
            }

            const laterCareerSummary = person.laterCareerSummary || person.industrySummary;
            if (laterCareerSummary) {
                const careerHeading = document.createElement("h3");
                careerHeading.textContent = "Later career";
                const career = document.createElement("p");
                appendLinkedProfileText(career, laterCareerSummary, person);
                details.append(careerHeading, career);
            }

            if (person.sources?.length) {
                const sourcesHeading = document.createElement("h3");
                sourcesHeading.textContent = "Sources";
                details.append(sourcesHeading, renderPersonSources(person.sources));
            }

            if (!person.astrocadeSummary && !person.laterCareerSummary && !person.industrySummary &&
                !person.accomplishments?.length &&
                !person.sources?.length && !connections) {
                const pending = document.createElement("p");
                pending.className = "person-profile-pending";
                pending.textContent = "Identity confirmation and sourced profile research are pending.";
                details.append(pending);
            }
            card.append(details);
            directory.append(card);
        }
        elements.content.append(directory);
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
    if (!state.sender && !state.keyword && !state.topic && !state.personFilter) {
        elements.activeFilter.hidden = true;
        return;
    }

    const label = document.createElement("span");
    if (state.sender) {
        const sender = state.senders.find((entry) => entry.key === state.sender);
        label.textContent = `Sender: ${sender?.name || state.sender} · ${messageCount.toLocaleString()} messages`;
    } else if (state.keyword) {
        label.textContent = `Keyword: ${state.keyword} · ${messageCount.toLocaleString()} messages`;
    } else if (state.personFilter) {
        const person = state.people.find((entry) => entry.id === state.personFilter);
        const relation = state.personFilterType === "authored" ? "Authored by" : "Mentions of";
        label.textContent = `${relation} ${person?.name || state.personFilter} · ${messageCount.toLocaleString()} messages`;
    } else {
        const topic = state.topics.find((entry) => entry.id === state.topic);
        label.textContent = `Topic: ${topic?.label || state.topic} · ${messageCount.toLocaleString()} messages`;
    }

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "clear-filter";
    clear.textContent = "Clear filter";
    clear.addEventListener("click", () => {
        location.hash = state.topic ? "topics" : (state.personFilter ? "people" : "messages");
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
    } else if (state.view === "people") {
        elements.search.placeholder = "Search people, roles, or accomplishments";
        renderPeople();
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
    const [manifestResponse, messagesResponse, keywordsResponse, topicsResponse, peopleResponse] = await Promise.all([
        fetch("data/manifest.json"),
        fetch("data/messages.json"),
        fetch("data/keywords.json"),
        fetch("data/topics.json"),
        fetch("data/people.json").catch(() => null)
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
    if (peopleResponse?.ok) {
        const peopleCatalog = await peopleResponse.json();
        state.people = peopleCatalog.people || [];
        state.organizations = peopleCatalog.organizations || [];
        state.projects = peopleCatalog.projects || [];
        state.relationships = peopleCatalog.relationships || [];
    }
    buildPeopleSenderIndex();
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

elements.messageDialogClose.addEventListener("click", () => {
    elements.messageDialog.close();
});

elements.messageDialogPrevious.addEventListener("click", () => {
    navigateMessageReader("previous");
});

elements.messageDialogNext.addEventListener("click", () => {
    navigateMessageReader("next");
});

elements.messageDialogSender.addEventListener("click", () => {
    const message = state.messageByNumber.get(state.previewNumber);
    if (!message) {
        return;
    }
    state.query = "";
    elements.search.value = "";
    elements.messageDialog.close();
    location.hash = `sender=${encodeURIComponent(message.senderKey)}`;
});

elements.messageDialog.addEventListener("close", () => {
    readerNavigation.loadGeneration += 1;
    state.previewNumber = null;
    document.documentElement.classList.remove("message-reader-open");
    hideReaderBoundaryHint();
    updatePreviewTriggers();
});

elements.messageDialog.addEventListener("click", (event) => {
    if (event.target === elements.messageDialog) {
        elements.messageDialog.close();
    }
});

elements.messageDialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigateMessageReader("previous");
    } else if (event.key === "ArrowRight") {
        event.preventDefault();
        navigateMessageReader("next");
    }
});

elements.messageDialogBody.addEventListener("scroll", updateReaderBoundaryHint, { passive: true });

elements.messageDialogBody.addEventListener("wheel", (event) => {
    const body = elements.messageDialogBody;
    const atTop = body.scrollTop <= 1;
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
    if (event.deltaY < 0 && atTop) {
        event.preventDefault();
        navigateMessageReader("previous");
    } else if (event.deltaY > 0 && atBottom) {
        event.preventDefault();
        navigateMessageReader("next");
    }
}, { passive: false });

elements.messageDialogBody.addEventListener("touchstart", (event) => {
    const body = elements.messageDialogBody;
    const atTop = body.scrollTop <= 1;
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 1;
    readerNavigation.touchStartY = event.touches[0]?.clientY ?? null;
    readerNavigation.touchBoundary = atTop && !atBottom
        ? "previous"
        : (atBottom && !atTop ? "next" : (atTop && atBottom ? "both" : null));
    readerNavigation.touchNavigated = false;
}, { passive: true });

elements.messageDialogBody.addEventListener("touchmove", (event) => {
    if (readerNavigation.touchStartY === null || readerNavigation.touchNavigated) {
        return;
    }
    const currentY = event.touches[0]?.clientY;
    if (currentY === undefined) {
        return;
    }
    const movement = readerNavigation.touchStartY - currentY;
    const wantsNext = movement > 48 && ["next", "both"].includes(readerNavigation.touchBoundary);
    const wantsPrevious = movement < -48 && ["previous", "both"].includes(readerNavigation.touchBoundary);
    if (wantsNext || wantsPrevious) {
        event.preventDefault();
        readerNavigation.touchNavigated = true;
        navigateMessageReader(wantsNext ? "next" : "previous");
    }
}, { passive: false });

elements.messageDialogBody.addEventListener("touchend", () => {
    readerNavigation.touchStartY = null;
    readerNavigation.touchBoundary = null;
    readerNavigation.touchNavigated = false;
}, { passive: true });

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
