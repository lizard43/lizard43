// Filename: archive.js
// Version: 20260922-011320

"use strict";

const DEFAULT_PAGE_SIZE = 100;
const BODY_SEARCH_BATCH_SIZE = 6;
const SETTINGS_KEY = "bally-alley-archive-settings";
const bodyChunkCache = new Map();
const bodySearchWork = {
  generation: 0,
  running: false,
  processed: 0,
  total: 0,
};
const readerNavigation = {
  loadGeneration: 0,
  scrollFrame: null,
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
    direction: "desc",
  },
  threadSort: {
    column: "date",
    direction: "desc",
  },
  senderSort: {
    column: "count",
    direction: "desc",
  },
  topicSort: {
    column: "name",
    direction: "asc",
  },
  pageSize: DEFAULT_PAGE_SIZE,
  page: 1,
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
  messageDialogThreadStatus: document.querySelector(
    "#messageDialogThreadStatus",
  ),
  messageDialogNext: document.querySelector("#messageDialogNext"),
  messageDialogClose: document.querySelector("#messageDialogClose"),
  messageDialogBody: document.querySelector("#messageDialogBody"),
  messageDialogText: document.querySelector("#messageDialogText"),
};

const peopleNetwork = {
  root: null,
  stage: null,
  svg: null,
  viewport: null,
  linkLayer: null,
  nodeLayer: null,
  simulation: null,
  zoom: null,
  nodes: [],
  links: [],
  selectedId: null,
  resizeObserver: null,
  settleTimer: null,
  searchOpen: false,
  mobileQuery: matchMedia("(max-width: 700px)"),
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
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        pageSize: state.pageSize,
        threaded: state.threaded,
        searchBodies: state.searchBodies,
      }),
    );
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
      lastPosted: message.date,
    };
    current.count += 1;
    if (
      new Date(message.date).getTime() > new Date(current.lastPosted).getTime()
    ) {
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
  state.threadDataAvailable =
    messages.length > 0 &&
    messages.every((message) => Object.hasOwn(message, "threadRootNumber"));

  for (const message of messages) {
    message.number = Number(message.number);
    message.threadRootNumber = Number(
      message.threadRootNumber ?? message.number,
    );
    message.parentNumber =
      message.parentNumber == null ? null : Number(message.parentNumber);
    state.messageByNumber.set(message.number, message);
    const thread = state.threadMessages.get(message.threadRootNumber) || [];
    thread.push(message);
    state.threadMessages.set(message.threadRootNumber, thread);
  }

  for (const thread of state.threadMessages.values()) {
    thread.sort(
      (left, right) =>
        new Date(left.date).getTime() - new Date(right.date).getTime() ||
        left.number - right.number,
    );
  }

  if (!state.threadDataAvailable) {
    state.threaded = false;
  }
}

function clearPreview() {
  state.previewNumber = null;
  readerNavigation.loadGeneration += 1;
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
  } else if (
    ["person-authored", "person-mentions", "person-related"].includes(kind) &&
    encodedValue
  ) {
    state.view = "messages";
    state.personFilter = decodeURIComponent(encodedValue);
    state.personFilterType =
      kind === "person-authored" ? "authored" : "mentions";
  } else if (kind === "people") {
    state.view = "people";
    state.expandedPerson = encodedValue
      ? decodeURIComponent(encodedValue)
      : null;
  } else if (
    ["people-organization", "people-project"].includes(kind) &&
    encodedValue
  ) {
    state.view = "people";
    state.peopleEntityFilter = {
      type: kind === "people-organization" ? "organization" : "project",
      id: decodeURIComponent(encodedValue),
    };
  } else if (
    ["messages", "senders", "topics", "people", "keywords"].includes(kind)
  ) {
    state.view = kind;
  } else {
    state.view = "messages";
  }
  state.page = 1;
}

function searchableMessage(message) {
  return `${message.number} ${message.date} ${message.sender} ${message.subject}`.toLocaleLowerCase(
    "en-US",
  );
}

function fetchBodyChunk(chunkName) {
  let request = bodyChunkCache.get(chunkName);
  if (!request) {
    const version = encodeURIComponent(state.manifest.generatedAt);
    request = fetch(`data/bodies/${chunkName}?v=${version}`).then(
      (response) => {
        if (!response.ok) {
          throw new Error(
            `Message preview data returned HTTP ${response.status}.`,
          );
        }
        return response.json();
      },
    );
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
    ? Math.round((bodySearchWork.processed * 100) / bodySearchWork.total)
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
  button.classList.toggle(
    "active",
    state.threaded && state.threadDataAvailable,
  );
  button.setAttribute(
    "aria-pressed",
    String(state.threaded && state.threadDataAvailable),
  );
  const label = state.threadDataAvailable
    ? state.threaded
      ? "Show flat message list"
      : "Group messages by thread"
    : "Run the updated site export to enable threads";
  button.setAttribute("aria-label", label);
  button.title = label;
}

function buildBodySearchSnippet(body, query) {
  const text = String(body || "")
    .replace(/\s+/g, " ")
    .trim();
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
    document.createTextNode(text.slice(matchIndex + query.length)),
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

  const chunks = [
    ...new Set(state.messages.map((message) => message.bodyChunk)),
  ];
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
        if (
          String(body || "")
            .toLocaleLowerCase("en-US")
            .includes(query)
        ) {
          const number = Number(messageNumber);
          state.bodySearchMatches.add(number);
          state.bodySearchSnippets.set(
            number,
            buildBodySearchSnippet(body, query),
          );
        }
      }
    }

    setBodySearchProgress(
      true,
      Math.min(index + batch.length, chunks.length),
      chunks.length,
    );
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
    const keyword = state.keywords.find(
      (entry) => entry.term === state.keyword,
    );
    const messageNumbers = new Set(keyword?.messages || []);
    messages = messages.filter((message) => messageNumbers.has(message.number));
  }

  if (state.topic) {
    const topic = state.topics.find((entry) => entry.id === state.topic);
    const messageNumbers = new Set(topic?.messages || []);
    messages = messages.filter((message) => messageNumbers.has(message.number));
  }

  if (state.personFilter) {
    const person = state.people.find(
      (entry) => entry.id === state.personFilter,
    );
    if (state.personFilterType === "authored") {
      const senderKeys = new Set(person?.senderKeys || []);
      messages = messages.filter((message) =>
        senderKeys.has(message.senderKey),
      );
    } else {
      const topic = state.topics.find((entry) => entry.id === person?.topicId);
      const messageNumbers = new Set(topic?.messages || []);
      const senderKeys = new Set(person?.senderKeys || []);
      messages = messages.filter(
        (message) =>
          messageNumbers.has(message.number) &&
          !senderKeys.has(message.senderKey),
      );
    }
  }

  if (state.query) {
    const query = state.query.toLocaleLowerCase("en-US");
    messages = messages.filter(
      (message) =>
        searchableMessage(message).includes(query) ||
        (state.searchBodies &&
          state.bodySearchMatches.has(Number(message.number))),
    );
  }

  return messages;
}

function messageIndicators({
  messageCount = null,
  attachmentCount = 0,
  matchCount = null,
} = {}) {
  const indicators = document.createElement("span");
  indicators.className = "message-row-indicators";

  if (messageCount !== null) {
    const count = document.createElement("span");
    count.className = "thread-message-count";
    count.textContent = Number(messageCount).toLocaleString();
    count.setAttribute(
      "aria-label",
      `${Number(messageCount).toLocaleString()} messages`,
    );
    count.title =
      matchCount !== null && matchCount !== messageCount
        ? `${Number(matchCount).toLocaleString()} matching messages out of ${Number(messageCount).toLocaleString()}`
        : `${Number(messageCount).toLocaleString()} messages`;
    indicators.append(count);
  }

  if (attachmentCount > 0) {
    const clip = document.createElement("span");
    clip.className = "attachment-indicator";
    clip.setAttribute(
      "aria-label",
      `${Number(attachmentCount).toLocaleString()} ${attachmentCount === 1 ? "attachment" : "attachments"}`,
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
  button.setAttribute(
    "aria-expanded",
    String(state.previewNumber === message.number),
  );
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
  const threadIndex = thread.findIndex(
    (entry) => entry.number === message.number,
  );
  return {
    thread,
    index: threadIndex,
    previous: threadIndex > 0 ? thread[threadIndex - 1] : null,
    next:
      threadIndex >= 0 && threadIndex < thread.length - 1
        ? thread[threadIndex + 1]
        : null,
  };
}

function updatePreviewTriggers() {
  for (const trigger of document.querySelectorAll("[data-message-number]")) {
    trigger.setAttribute(
      "aria-expanded",
      String(
        elements.messageDialog.open &&
          Number(trigger.dataset.messageNumber) === state.previewNumber,
      ),
    );
  }
}

function setReaderCurrentMessage(message) {
  const position = readerThreadPosition(message);
  state.previewNumber = message.number;

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
  elements.messageDialogThreadStatus.textContent = `${position.index + 1} of ${position.thread.length}`;

  for (const section of elements.messageDialogText.querySelectorAll(
    ".thread-reader-message",
  )) {
    const current = Number(section.dataset.messageNumber) === message.number;
    section.classList.toggle("is-current", current);
    if (current) {
      section.setAttribute("aria-current", "true");
    } else {
      section.removeAttribute("aria-current");
    }
  }
  updatePreviewTriggers();
}

function readerMessageSection(message, body) {
  const section = document.createElement("article");
  section.className = "thread-reader-message";
  section.dataset.messageNumber = String(message.number);
  section.id = `reader-message-${message.number}`;

  const header = document.createElement("header");
  header.className = "thread-reader-message-header";

  const subject = document.createElement("h3");
  subject.textContent = message.subject;
  const meta = document.createElement("div");
  meta.className = "thread-reader-message-meta";
  const sender = document.createElement("strong");
  sender.textContent = message.senderName || message.sender;
  meta.append(sender);
  if (message.senderAddress) {
    const address = document.createElement("span");
    address.className = "thread-reader-address";
    address.textContent = message.senderAddress;
    meta.append(address);
  }
  meta.append(messageDateElement(message.date));
  const number = document.createElement("span");
  number.textContent = `Msg #${message.number}`;
  meta.append(number);
  header.append(subject, meta);

  const text = document.createElement("pre");
  text.className = "thread-reader-message-text";
  text.textContent = body;
  section.append(header, text);
  return section;
}

function updateReaderEndSpace() {
  const sections = elements.messageDialogText.querySelectorAll(
    ".thread-reader-message",
  );
  const lastSection = sections[sections.length - 1];
  if (!lastSection) {
    elements.messageDialogText.style.paddingBottom = "";
    return;
  }
  const endSpace = Math.max(
    0,
    elements.messageDialogBody.clientHeight - lastSection.offsetHeight,
  );
  elements.messageDialogText.style.paddingBottom = `${endSpace}px`;
}

function scrollReaderToMessage(message, behavior = "smooth") {
  const target = elements.messageDialogText.querySelector(
    `[data-message-number="${message.number}"]`,
  );
  if (!target) {
    return;
  }
  setReaderCurrentMessage(message);
  updateReaderEndSpace();
  const bodyBounds = elements.messageDialogBody.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  const top =
    elements.messageDialogBody.scrollTop + targetBounds.top - bodyBounds.top;
  elements.messageDialogBody.scrollTo({ top, behavior });
}

function syncReaderCurrentMessage() {
  readerNavigation.scrollFrame = null;
  const sections = [
    ...elements.messageDialogText.querySelectorAll(".thread-reader-message"),
  ];
  if (!sections.length) {
    return;
  }
  const readerTop = elements.messageDialogBody.getBoundingClientRect().top + 2;
  let currentSection = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= readerTop) {
      currentSection = section;
    } else {
      break;
    }
  }
  const message = state.messageByNumber.get(
    Number(currentSection.dataset.messageNumber),
  );
  if (message && message.number !== state.previewNumber) {
    setReaderCurrentMessage(message);
  }
}

async function openMessageReader(message) {
  const generation = ++readerNavigation.loadGeneration;
  state.previewNumber = message.number;
  const position = readerThreadPosition(message);
  elements.messageDialogText.textContent = "Loading message…";
  setReaderCurrentMessage(message);

  if (!elements.messageDialog.open) {
    syncChromeHeight();
    elements.messageDialog.showModal();
    document.documentElement.classList.add("message-reader-open");
  }
  updatePreviewTriggers();

  const bodies = await Promise.all(position.thread.map(messageBody));
  if (
    generation !== readerNavigation.loadGeneration ||
    state.previewNumber !== message.number
  ) {
    return;
  }
  elements.messageDialogText.replaceChildren(
    ...position.thread.map((entry, index) =>
      readerMessageSection(entry, bodies[index]),
    ),
  );
  setReaderCurrentMessage(message);
  requestAnimationFrame(() => {
    updateReaderEndSpace();
    scrollReaderToMessage(message, "auto");
    elements.messageDialogBody.focus({ preventScroll: true });
  });
}

function navigateMessageReader(direction) {
  const message = state.messageByNumber.get(state.previewNumber);
  if (!message) {
    return;
  }
  const position = readerThreadPosition(message);
  const target = direction === "previous" ? position.previous : position.next;
  if (target) {
    scrollReaderToMessage(target);
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
    return `${message.senderName || message.sender} ${message.senderAddress || ""}`.toLocaleLowerCase(
      "en-US",
    );
  }
  return message.subject.toLocaleLowerCase("en-US");
}

function sortedMessages(messages) {
  const { column, direction } = state.messageSort;
  const multiplier = direction === "asc" ? 1 : -1;
  return [...messages].sort((left, right) => {
    const leftValue = messageSortValue(left, column);
    const rightValue = messageSortValue(right, column);
    const comparison =
      typeof leftValue === "string"
        ? leftValue.localeCompare(rightValue)
        : leftValue - rightValue;
    return (
      comparison * multiplier || Number(right.number) - Number(left.number)
    );
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
    subject: "Subject",
  };
  const sortState = state.threaded ? state.threadSort : state.messageSort;

  for (const button of table.querySelectorAll("[data-message-sort]")) {
    const column = button.dataset.messageSort;
    const active = sortState.column === column;
    button.textContent = `${labels[column]}${
      active ? (sortState.direction === "asc" ? " ▲" : " ▼") : ""
    }`;
    const header = button.closest("th");
    if (active) {
      header.setAttribute(
        "aria-sort",
        sortState.direction === "asc" ? "ascending" : "descending",
      );
    }
    button.addEventListener("click", () => {
      runBusy(() => {
        if (active) {
          sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
        } else {
          sortState.column = column;
          sortState.direction = ["number", "date"].includes(column)
            ? "desc"
            : "asc";
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
    day: "2-digit",
  };
  if (includeTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
    options.hourCycle = "h23";
  }
  return new Map(
    new Intl.DateTimeFormat("en-US", options)
      .formatToParts(new Date(date))
      .map((part) => [part.type, part.value]),
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
    cell.append(
      searchMatchSnippet(snippet, state.query.toLocaleLowerCase("en-US")),
    );
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
    attachmentCount: Number(message.attachments) || 0,
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
  elements.pageStatus.textContent = `${messages.length.toLocaleString()} messages · Page ${state.page} of ${pageCount}`;
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

  return [...matchesByRoot.entries()]
    .map(([rootNumber, matches]) => {
      const thread = state.threadMessages.get(rootNumber) || [];
      const root = state.messageByNumber.get(rootNumber) || thread[0];
      return {
        rootNumber,
        root,
        latest: thread[thread.length - 1] || root,
        messages: thread,
        matches,
      };
    })
    .filter((entry) => entry.root);
}

function threadSortValue(thread, column) {
  if (column === "number") {
    return thread.rootNumber;
  }
  if (column === "date") {
    return new Date(thread.latest.date).getTime();
  }
  if (column === "sender") {
    return `${thread.root.senderName || thread.root.sender} ${thread.root.senderAddress || ""}`.toLocaleLowerCase(
      "en-US",
    );
  }
  return thread.root.subject.toLocaleLowerCase("en-US");
}

function sortedThreadEntries(threads) {
  const { column, direction } = state.threadSort;
  const multiplier = direction === "asc" ? 1 : -1;
  return [...threads].sort((left, right) => {
    const leftValue = threadSortValue(left, column);
    const rightValue = threadSortValue(right, column);
    const comparison =
      typeof leftValue === "string"
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
    toggle.setAttribute(
      "aria-label",
      `${expanded ? "Collapse" : "Expand"} thread ${thread.rootNumber}`,
    );
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
    0,
  );
  senderColumn.append(senderCell(thread.root));

  const subjectCell = document.createElement("td");
  const mentionMessage =
    state.personFilterType === "mentions"
      ? [...thread.messages]
          .reverse()
          .find((message) => thread.matches.has(message.number))
      : null;
  subjectCell.append(
    previewTrigger(mentionMessage || thread.root, thread.root.subject),
  );
  const indicators = messageIndicators({
    messageCount: thread.messages.length,
    attachmentCount,
    matchCount: thread.matches.size,
  });
  if (indicators.childElementCount) {
    subjectCell.append(indicators);
  }
  const searchSnippetMessage = thread.messages.find(
    (message) =>
      thread.matches.has(message.number) &&
      state.bodySearchSnippets.has(message.number),
  );
  if (searchSnippetMessage) {
    const snippet = searchMatchSnippet(
      state.bodySearchSnippets.get(searchSnippetMessage.number),
      state.query.toLocaleLowerCase("en-US"),
    );
    if (searchSnippetMessage.number !== thread.root.number) {
      snippet.prepend(
        document.createTextNode(`#${searchSnippetMessage.number}: `),
      );
    }
    subjectCell.append(snippet);
  } else if (mentionMessage) {
    const snippet = personMentionSnippet(
      mentionMessage,
      mentionMessage.number !== thread.root.number,
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
          dimmed:
            thread.matches.size !== thread.messages.length &&
            !thread.matches.has(message.number),
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
  const visible = entries.filter(
    (entry) =>
      !query || toLabel(entry).toLocaleLowerCase("en-US").includes(query),
  );
  for (const entry of visible) {
    grid.append(
      directoryButton(toLabel(entry), entry.count, () => onSelect(entry)),
    );
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
      state.senderSort.direction =
        state.senderSort.direction === "asc" ? "desc" : "asc";
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
    const label = `${sender.name} ${sender.address || ""}`.toLocaleLowerCase(
      "en-US",
    );
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
      ["Posted", "lastPosted"],
    ]) {
      const header = document.createElement("th");
      header.scope = "col";
      if (state.senderSort.column === column) {
        header.setAttribute(
          "aria-sort",
          state.senderSort.direction === "asc" ? "ascending" : "descending",
        );
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
    const searchable =
      `${topic.label} ${topic.category} ${topic.description}`.toLocaleLowerCase(
        "en-US",
      );
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
      ["Posted", "lastPosted"],
    ]) {
      const header = document.createElement("th");
      header.scope = "col";
      if (state.topicSort.column === column) {
        header.setAttribute(
          "aria-sort",
          state.topicSort.direction === "asc" ? "ascending" : "descending",
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
        dateColumn,
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
  const count =
    type === "authored"
      ? person.authoredMessageCount
      : person.mentionMessageCount;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "person-message-button";

  const total = document.createElement("strong");
  total.textContent = Number(count || 0).toLocaleString();
  const label = document.createElement("span");
  label.textContent =
    type === "authored" ? "Authored messages" : "Mentions by others";
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
    for (const term of [
      topic.label,
      ...(topic.terms || []),
      ...(topic.aliases || []),
    ]) {
      const normalized = String(term || "")
        .normalize("NFKC")
        .trim();
      if (normalized) terms.set(normalized.toLocaleLowerCase("en-US"), topic);
    }
  }
  return [...terms.entries()].sort(
    (left, right) => right[0].length - left[0].length,
  );
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
    "giu",
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
    const label =
      typeof source === "string" ? source : source.label || source.url;
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
  const collection =
    type === "organization" ? state.organizations : state.projects;
  const ids =
    type === "organization"
      ? relationship.organizationIds || []
      : relationship.projectIds || [];
  return ids.map(
    (id) => collection.find((entry) => entry.id === id) || { id, name: id },
  );
}

function relationshipsForEntity(type, id) {
  const field = type === "organization" ? "organizationIds" : "projectIds";
  return state.relationships.filter((relationship) =>
    (relationship[field] || []).includes(id),
  );
}

function entityTopic(entity) {
  return (
    state.topics.find((topic) => topic.id === (entity.topicId || entity.id)) ||
    null
  );
}

function renderPeopleEntityFocus() {
  const filter = state.peopleEntityFilter;
  if (!filter) return null;
  const collection =
    filter.type === "organization" ? state.organizations : state.projects;
  const entity = collection.find((entry) => entry.id === filter.id);
  if (!entity) return null;
  const relationships = relationshipsForEntity(filter.type, filter.id);
  const peopleIds = new Set(
    relationships.flatMap((relationship) =>
      (relationship.participants || [])
        .map((participant) => participant.personId)
        .filter(Boolean),
    ),
  );
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
  summary.textContent =
    `${peopleIds.size.toLocaleString()} connected people · ` +
    `${relationships.length.toLocaleString()} documented relationships`;
  panel.append(heading, summary);
  const topic = entityTopic(entity);
  if (topic?.messageCount) {
    const messages = profileTopicAnchor(
      topic,
      `${topic.messageCount.toLocaleString()} related messages`,
    );
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
  const names = [...personByName.keys()].sort(
    (left, right) => right.length - left.length,
  );
  if (!names.length) {
    container.textContent = text;
    return;
  }
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${names.map(escapeRegularExpression).join("|")})(?![\\p{L}\\p{N}])`,
    "giu",
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
    (relationship.participants || []).some(
      (participant) => participant.personId === person.id,
    ),
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
    const organizations = relationshipEntities(
      relationship,
      "organization",
    ).filter(
      (entry) =>
        entry.name.toLocaleLowerCase("en-US") !==
        String(relationship.label || "").toLocaleLowerCase("en-US"),
    );
    const projects = relationshipEntities(relationship, "project");
    const title = document.createElement("h4");
    title.textContent = relationship.label || "Documented connection";
    item.append(title);
    if (relationship.period || organizations.length || projects.length) {
      const metadata = document.createElement("span");
      metadata.className = "person-connection-metadata";
      const groups = [];
      if (relationship.period)
        groups.push(document.createTextNode(relationship.period));
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
        const label =
          typeof source === "string" ? source : source.label || source.url;
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

function personSearchText(person) {
  const relationshipText = state.relationships
    .filter((relationship) =>
      (relationship.participants || []).some(
        (participant) => participant.personId === person.id,
      ),
    )
    .flatMap((relationship) => [
      relationship.label,
      relationship.period,
      relationship.description,
      ...relationshipEntities(relationship, "organization").map(
        (entry) => entry.name,
      ),
      ...relationshipEntities(relationship, "project").map(
        (entry) => entry.name,
      ),
    ]);
  return [
    person.name,
    ...(person.aliases || []),
    person.astrocadeRole,
    person.astrocadeSummary,
    person.laterCareerSummary,
    person.industrySummary,
    ...(person.accomplishments || []),
    ...relationshipText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");
}

function buildPeopleGraph() {
  const nodes = state.people.map((person) => ({
    ...person,
    searchText: personSearchText(person),
  }));
  const nodeIds = new Set(nodes.map((person) => person.id));
  const linksByPair = new Map();

  for (const relationship of state.relationships) {
    const participants = [
      ...new Set(
        (relationship.participants || [])
          .map((participant) => participant.personId)
          .filter((personId) => nodeIds.has(personId)),
      ),
    ];
    for (let left = 0; left < participants.length; left += 1) {
      for (let right = left + 1; right < participants.length; right += 1) {
        const pair = [participants[left], participants[right]].sort();
        const key = pair.join("|");
        const link = linksByPair.get(key) || {
          id: key,
          source: pair[0],
          target: pair[1],
          relationships: [],
        };
        link.relationships.push(relationship);
        linksByPair.set(key, link);
      }
    }
  }

  return { nodes, links: [...linksByPair.values()] };
}

function peopleNodeId(endpoint) {
  return typeof endpoint === "object" ? endpoint.id : endpoint;
}

function peopleDirectLinks(personId) {
  return peopleNetwork.links.filter(
    (link) =>
      peopleNodeId(link.source) === personId ||
      peopleNodeId(link.target) === personId,
  );
}

function peoplePeerId(link, personId) {
  return peopleNodeId(link.source) === personId
    ? peopleNodeId(link.target)
    : peopleNodeId(link.source);
}

function peopleGraphDimensions() {
  const width = Math.max(320, peopleNetwork.stage?.clientWidth || 0);
  const height = Math.max(320, peopleNetwork.stage?.clientHeight || 0);
  return { width, height };
}

function peopleGraphAvailableArea() {
  const { width, height } = peopleGraphDimensions();
  const panel = peopleNetwork.root?.querySelector(".people-profile-panel");
  if (!panel || panel.hidden || !peopleNetwork.selectedId) {
    return { width, height, centerX: width / 2, centerY: height / 2 };
  }
  if (peopleNetwork.mobileQuery.matches) {
    const panelHeight = panel.getBoundingClientRect().height;
    const availableHeight = Math.max(150, height - panelHeight);
    return {
      width,
      height: availableHeight,
      centerX: width / 2,
      centerY: availableHeight / 2,
    };
  }
  const panelWidth = panel.getBoundingClientRect().width;
  const availableWidth = Math.max(240, width - panelWidth);
  return {
    width: availableWidth,
    height,
    centerX: availableWidth / 2,
    centerY: height / 2,
  };
}

function peopleGraphDegrees() {
  const counts = new Map(peopleNetwork.nodes.map((node) => [node.id, 0]));
  for (const link of peopleNetwork.links) {
    counts.set(
      peopleNodeId(link.source),
      (counts.get(peopleNodeId(link.source)) || 0) + 1,
    );
    counts.set(
      peopleNodeId(link.target),
      (counts.get(peopleNodeId(link.target)) || 0) + 1,
    );
  }
  return counts;
}

function fitPeopleNodes(nodes, anchor, duration = 650) {
  if (
    !peopleNetwork.svg ||
    !nodes.length ||
    !anchor ||
    !Number.isFinite(anchor.x)
  )
    return;
  const area = peopleGraphAvailableArea();
  const padding = peopleNetwork.mobileQuery.matches ? 52 : 76;
  const maxX = Math.max(1, ...nodes.map((node) => Math.abs(node.x - anchor.x)));
  const maxY = Math.max(1, ...nodes.map((node) => Math.abs(node.y - anchor.y)));
  const scale = Math.max(
    0.18,
    Math.min(
      1.18,
      (area.width - padding * 2) / (maxX * 2),
      (area.height - padding * 2) / (maxY * 2),
    ),
  );
  const transform = d3.zoomIdentity
    .translate(area.centerX - anchor.x * scale, area.centerY - anchor.y * scale)
    .scale(scale);
  peopleNetwork.svg
    .interrupt()
    .transition()
    .duration(duration)
    .ease(d3.easeCubicOut)
    .call(peopleNetwork.zoom.transform, transform);
}

function fitPeopleOverview(duration = 650) {
  const anchor =
    peopleNetwork.nodes.find((node) => node.id === "dave-nutting") ||
    peopleNetwork.nodes[0];
  fitPeopleNodes(peopleNetwork.nodes, anchor, duration);
}

function fitSelectedPerson(duration = 650) {
  const selected = peopleNetwork.nodes.find(
    (node) => node.id === peopleNetwork.selectedId,
  );
  if (!selected) return;
  const peers = new Set(
    peopleDirectLinks(selected.id).map((link) =>
      peoplePeerId(link, selected.id),
    ),
  );
  const localNodes = peopleNetwork.nodes.filter(
    (node) => node.id === selected.id || peers.has(node.id),
  );
  fitPeopleNodes(localNodes, selected, duration);
}

function updatePeopleLabelVisibility() {
  if (!peopleNetwork.nodeLayer) return;
  const transform = d3.zoomTransform(peopleNetwork.svg.node());
  const degrees = peopleGraphDegrees();
  const selectedId = peopleNetwork.selectedId;
  const peers = new Set(
    selectedId
      ? peopleDirectLinks(selectedId).map((link) =>
          peoplePeerId(link, selectedId),
        )
      : [],
  );
  const threshold = peopleNetwork.mobileQuery.matches
    ? transform.k < 0.7
      ? 62
      : 46
    : transform.k < 0.55
      ? 48
      : 34;
  const visible = [];
  const ordered = [...peopleNetwork.nodes].sort((left, right) => {
    const priority = (node) =>
      (node.id === selectedId ? 1000 : 0) +
      (peers.has(node.id) ? 500 : 0) +
      (node.id === "dave-nutting" ? 300 : 0) +
      (degrees.get(node.id) || 0) * 8;
    return priority(right) - priority(left);
  });
  for (const node of ordered) {
    const forced =
      node.id === selectedId ||
      peers.has(node.id) ||
      node.id === "dave-nutting";
    const clear = visible.every(
      (other) => Math.hypot(node.x - other.x, node.y - other.y) >= threshold,
    );
    if (forced || clear || transform.k >= 1.2) visible.push(node);
  }
  peopleNetwork.nodeLayer
    .selectAll(".people-node-label")
    .style("display", (node) => (visible.includes(node) ? null : "none"));
}

function applyPeopleNetworkFocus() {
  if (!peopleNetwork.nodeLayer) return;
  const selectedId = peopleNetwork.selectedId;
  const peers = new Set(
    selectedId
      ? peopleDirectLinks(selectedId).map((link) =>
          peoplePeerId(link, selectedId),
        )
      : [],
  );
  peopleNetwork.nodeLayer
    .selectAll(".people-node-group")
    .classed("selected", (node) => node.id === selectedId)
    .classed("connected", (node) => peers.has(node.id))
    .classed(
      "dimmed",
      (node) =>
        Boolean(selectedId) && node.id !== selectedId && !peers.has(node.id),
    );
  peopleNetwork.linkLayer
    .selectAll(".people-network-link")
    .classed(
      "connected",
      (link) =>
        Boolean(selectedId) &&
        (peopleNodeId(link.source) === selectedId ||
          peopleNodeId(link.target) === selectedId),
    )
    .classed(
      "dimmed",
      (link) =>
        Boolean(selectedId) &&
        peopleNodeId(link.source) !== selectedId &&
        peopleNodeId(link.target) !== selectedId,
    );
  updatePeopleLabelVisibility();
}

function configurePeopleForces(focused = false) {
  if (!peopleNetwork.simulation) return;
  const { width, height } = peopleGraphDimensions();
  const selectedId = focused ? peopleNetwork.selectedId : null;
  const peers = new Set(
    selectedId
      ? peopleDirectLinks(selectedId).map((link) =>
          peoplePeerId(link, selectedId),
        )
      : [],
  );
  const area = peopleGraphAvailableArea();
  const degrees = peopleGraphDegrees();
  peopleNetwork.simulation
    .force("link")
    .distance((link) => {
      const selectedLink =
        selectedId &&
        (peopleNodeId(link.source) === selectedId ||
          peopleNodeId(link.target) === selectedId);
      return selectedLink
        ? peopleNetwork.mobileQuery.matches
          ? 128
          : 170
        : peopleNetwork.mobileQuery.matches
          ? 92
          : 118;
    })
    .strength((link) => (link.relationships.length > 1 ? 0.68 : 0.48));
  peopleNetwork.simulation
    .force(
      "charge",
      d3
        .forceManyBody()
        .strength((node) => {
          if (node.id === selectedId) return -760;
          if (peers.has(node.id)) return -560;
          return peopleNetwork.mobileQuery.matches ? -310 : -430;
        })
        .distanceMax(peopleNetwork.mobileQuery.matches ? 760 : Infinity),
    )
    .force(
      "collide",
      d3
        .forceCollide()
        .radius(
          (node) =>
            27 +
            Math.min(18, (degrees.get(node.id) || 0) * 1.2) +
            (node.id === selectedId || peers.has(node.id) ? 20 : 5),
        )
        .strength(0.96),
    )
    .force(
      "x",
      d3
        .forceX((node) => {
          if (node.id === selectedId) return area.centerX;
          return width / 2;
        })
        .strength((node) =>
          node.id === selectedId ? 0.45 : peers.has(node.id) ? 0.035 : 0.02,
        ),
    )
    .force(
      "y",
      d3
        .forceY((node) => {
          if (node.id === selectedId) return area.centerY;
          return height / 2;
        })
        .strength((node) =>
          node.id === selectedId ? 0.45 : peers.has(node.id) ? 0.035 : 0.02,
        ),
    )
    .force("center", d3.forceCenter(width / 2, height / 2));
}

function settlePeopleNetwork(focused) {
  clearTimeout(peopleNetwork.settleTimer);
  configurePeopleForces(focused);
  peopleNetwork.simulation.alpha(focused ? 0.72 : 0.92).restart();
  peopleNetwork.settleTimer = setTimeout(
    () => {
      peopleNetwork.simulation?.stop();
      if (focused) fitSelectedPerson();
      else fitPeopleOverview();
    },
    focused ? 780 : 1000,
  );
}

function renderPeopleProfile(person) {
  const panel = peopleNetwork.root.querySelector(".people-profile-panel");
  const content = panel.querySelector(".people-profile-content");
  content.replaceChildren();

  const header = document.createElement("header");
  header.className = "people-profile-header";
  const headingGroup = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = person.name;
  const role = document.createElement("p");
  role.className = "people-profile-role";
  role.textContent =
    person.astrocadeRole || "Identity and history review pending.";
  headingGroup.append(heading, role);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "people-profile-close";
  close.setAttribute("aria-label", `Close ${person.name} profile`);
  close.textContent = "×";
  close.addEventListener("click", () => selectPeopleNode(null));
  header.append(headingGroup, close);

  const actions = document.createElement("div");
  actions.className = "person-message-actions";
  actions.append(
    personMessageButton(person, "authored"),
    personMessageButton(person, "mentions"),
  );
  content.append(header, actions);

  if (person.aliases?.length) {
    const aliases = document.createElement("p");
    aliases.className = "people-profile-aliases";
    aliases.textContent = `Also known as ${person.aliases.join(", ")}`;
    content.append(aliases);
  }
  const relatedTopics = renderPersonTopics(person);
  if (relatedTopics) content.append(relatedTopics);

  if (person.astrocadeSummary) {
    const section = document.createElement("section");
    const sectionHeading = document.createElement("h3");
    sectionHeading.textContent = "Astrocade and early computing";
    const summary = document.createElement("p");
    appendLinkedProfileText(summary, person.astrocadeSummary, person);
    section.append(sectionHeading, summary);
    content.append(section);
  }

  const connections = renderPersonConnections(person);
  if (connections) content.append(connections);

  if (person.accomplishments?.length) {
    const section = document.createElement("section");
    const sectionHeading = document.createElement("h3");
    sectionHeading.textContent = "Selected accomplishments";
    const accomplishments = document.createElement("ul");
    accomplishments.className = "person-accomplishments";
    for (const accomplishment of person.accomplishments) {
      const item = document.createElement("li");
      appendLinkedProfileText(item, accomplishment, person);
      accomplishments.append(item);
    }
    section.append(sectionHeading, accomplishments);
    content.append(section);
  }

  const laterCareerSummary =
    person.laterCareerSummary || person.industrySummary;
  if (laterCareerSummary) {
    const section = document.createElement("section");
    const sectionHeading = document.createElement("h3");
    sectionHeading.textContent = "Later career";
    const career = document.createElement("p");
    appendLinkedProfileText(career, laterCareerSummary, person);
    section.append(sectionHeading, career);
    content.append(section);
  }

  if (person.sources?.length) {
    const section = document.createElement("section");
    const sectionHeading = document.createElement("h3");
    sectionHeading.textContent = "Sources";
    section.append(sectionHeading, renderPersonSources(person.sources));
    content.append(section);
  }

  if (
    !person.astrocadeSummary &&
    !laterCareerSummary &&
    !person.accomplishments?.length &&
    !person.sources?.length &&
    !connections
  ) {
    const pending = document.createElement("p");
    pending.className = "person-profile-pending";
    pending.textContent =
      "Identity confirmation and sourced profile research are pending.";
    content.append(pending);
  }
  content.scrollTop = 0;
}

function selectPeopleNode(personId, updateHash = true) {
  const person = personId
    ? state.people.find((entry) => entry.id === personId)
    : null;
  if (!person && updateHash) {
    state.peopleEntityFilter = null;
  }
  peopleNetwork.selectedId = person?.id || null;
  state.expandedPerson = peopleNetwork.selectedId;
  if (person) {
    peopleNetwork.searchOpen = false;
  }
  const panel = peopleNetwork.root?.querySelector(".people-profile-panel");
  if (panel) {
    panel.hidden = !person;
    peopleNetwork.root.classList.toggle("has-selection", Boolean(person));
    if (person) renderPeopleProfile(person);
  }
  applyPeopleNetworkFocus();
  settlePeopleNetwork(Boolean(person));
  if (person) {
    requestAnimationFrame(() => {
      if (peopleNetwork.selectedId === person.id) {
        fitSelectedPerson(240);
      }
    });
  }
  if (updateHash) {
    history.replaceState(
      null,
      "",
      person ? `#people=${encodeURIComponent(person.id)}` : "#people",
    );
  }
  updatePeopleSearchResults();
}

function updatePeopleSearchResults() {
  const results = peopleNetwork.root?.querySelector(
    ".people-network-search-results",
  );
  const toggle = peopleNetwork.root?.querySelector(
    ".people-network-search-toggle",
  );
  if (!results || !toggle) return;
  const query = state.query.toLocaleLowerCase("en-US");
  const entityRelationships = state.peopleEntityFilter
    ? relationshipsForEntity(
        state.peopleEntityFilter.type,
        state.peopleEntityFilter.id,
      )
    : [];
  const entityPeople = new Set(
    entityRelationships.flatMap((relationship) =>
      (relationship.participants || [])
        .map((participant) => participant.personId)
        .filter(Boolean),
    ),
  );
  const matches = peopleNetwork.nodes.filter(
    (person) =>
      (!query || person.searchText.includes(query)) &&
      (!state.peopleEntityFilter || entityPeople.has(person.id)),
  );
  const matchIds = new Set(matches.map((person) => person.id));
  const searchActive = Boolean(query || state.peopleEntityFilter);
  peopleNetwork.nodeLayer
    ?.selectAll(".people-node-group")
    .classed("search-mismatch", () => searchActive)
    .classed(
      "search-match",
      (person) => searchActive && matchIds.has(person.id),
    );

  const hasFilter = Boolean(query || state.peopleEntityFilter);
  const drawerOpen = hasFilter && peopleNetwork.searchOpen;
  results.replaceChildren();
  results.hidden = !drawerOpen;
  toggle.hidden = !hasFilter || drawerOpen;
  toggle.textContent = `${matches.length.toLocaleString()} ${matches.length === 1 ? "result" : "results"}`;
  toggle.setAttribute(
    "aria-label",
    `Show ${matches.length.toLocaleString()} people search ${matches.length === 1 ? "result" : "results"}`,
  );
  if (!drawerOpen) return;

  if (state.peopleEntityFilter) {
    const collection =
      state.peopleEntityFilter.type === "organization"
        ? state.organizations
        : state.projects;
    const entity = collection.find(
      (entry) => entry.id === state.peopleEntityFilter.id,
    );
    const context = document.createElement("div");
    context.className = "people-network-filter-label";
    context.textContent = `${entity?.name || state.peopleEntityFilter.id} · ${matches.length} people`;
    const clear = document.createElement("a");
    clear.href = "#people";
    clear.textContent = "Clear";
    context.append(clear);
    results.append(context);
  }
  if (!matches.length) {
    const empty = document.createElement("p");
    empty.className = "people-network-search-empty";
    empty.textContent = "No people match the current search.";
    results.append(empty);
    return;
  }
  for (const person of matches.slice(0, 8)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "people-network-result";
    const name = document.createElement("strong");
    name.textContent = person.name;
    const role = document.createElement("span");
    role.textContent = person.astrocadeRole || "Profile research pending";
    button.append(name, role);
    button.addEventListener("click", () => selectPeopleNode(person.id));
    results.append(button);
  }
}

function initializePeopleNetwork() {
  const graph = buildPeopleGraph();
  peopleNetwork.nodes = graph.nodes;
  peopleNetwork.links = graph.links;

  const root = document.createElement("section");
  root.className = "people-network-shell";
  const stage = document.createElement("div");
  stage.className = "people-network-stage";
  const summary = document.createElement("div");
  summary.className = "people-network-summary";
  summary.textContent =
    `${graph.nodes.length.toLocaleString()} people · ` +
    `${state.relationships.length.toLocaleString()} work records`;
  const searchResults = document.createElement("div");
  searchResults.className = "people-network-search-results";
  searchResults.hidden = true;
  const searchToggle = document.createElement("button");
  searchToggle.type = "button";
  searchToggle.className = "people-network-search-toggle";
  searchToggle.hidden = true;
  searchToggle.addEventListener("click", () => {
    peopleNetwork.searchOpen = true;
    updatePeopleSearchResults();
  });
  const hint = document.createElement("div");
  hint.className = "people-network-hint";
  hint.textContent = peopleNetwork.mobileQuery.matches
    ? "Drag nodes · Pinch to zoom · Tap a person"
    : "Drag nodes · Scroll to zoom · Select a person";
  const svgElement = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  svgElement.classList.add("people-network-svg");
  svgElement.setAttribute("role", "img");
  svgElement.setAttribute(
    "aria-label",
    "Network of people and documented work relationships",
  );
  const panel = document.createElement("aside");
  panel.className = "people-profile-panel";
  panel.hidden = true;
  const panelContent = document.createElement("div");
  panelContent.className = "people-profile-content";
  panel.append(panelContent);
  stage.append(
    svgElement,
    summary,
    searchResults,
    searchToggle,
    hint,
    panel,
  );
  root.append(stage);
  elements.content.replaceChildren(root);

  peopleNetwork.root = root;
  peopleNetwork.searchOpen = Boolean(state.query || state.peopleEntityFilter);
  peopleNetwork.stage = stage;
  peopleNetwork.svg = d3.select(svgElement);
  peopleNetwork.viewport = peopleNetwork.svg
    .append("g")
    .attr("class", "people-network-viewport");
  peopleNetwork.linkLayer = peopleNetwork.viewport
    .append("g")
    .attr("class", "people-network-links");
  peopleNetwork.nodeLayer = peopleNetwork.viewport
    .append("g")
    .attr("class", "people-network-nodes");
  peopleNetwork.zoom = d3
    .zoom()
    .scaleExtent([0.16, 4])
    .filter((event) =>
      ["wheel", "mousedown", "touchstart", "dblclick"].includes(event.type),
    )
    .on("zoom", (event) => {
      peopleNetwork.viewport.attr("transform", event.transform);
      updatePeopleLabelVisibility();
    });
  peopleNetwork.svg.call(peopleNetwork.zoom).on("dblclick.zoom", null);

  const degrees = peopleGraphDegrees();
  const links = peopleNetwork.linkLayer
    .selectAll("line")
    .data(peopleNetwork.links)
    .enter()
    .append("line")
    .attr("class", "people-network-link");
  const nodes = peopleNetwork.nodeLayer
    .selectAll("g")
    .data(peopleNetwork.nodes)
    .enter()
    .append("g")
    .attr("class", "people-node-group")
    .attr("tabindex", "0")
    .attr("role", "button")
    .attr("aria-label", (person) => `Open ${person.name} profile`)
    .on("click", (event, person) => {
      event.stopPropagation();
      selectPeopleNode(person.id);
    })
    .on("keydown", (event, person) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectPeopleNode(person.id);
      }
    });
  nodes
    .append("circle")
    .attr("class", "people-node-halo")
    .attr(
      "r",
      (person) => 15 + Math.min(14, (degrees.get(person.id) || 0) * 1.25),
    );
  nodes
    .append("circle")
    .attr("class", "people-node")
    .attr(
      "r",
      (person) => 8 + Math.min(10, (degrees.get(person.id) || 0) * 0.9),
    );
  nodes
    .append("text")
    .attr("class", "people-node-label")
    .attr(
      "dy",
      (person) => 19 + Math.min(9, (degrees.get(person.id) || 0) * 0.8),
    )
    .text((person) => person.name);

  const { width, height } = peopleGraphDimensions();
  peopleNetwork.nodes.forEach((node, index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = (Math.sqrt(index + 1) * Math.min(width, height)) / 11;
    node.x = width / 2 + Math.cos(angle) * radius;
    node.y = height / 2 + Math.sin(angle) * radius;
  });
  const dave = peopleNetwork.nodes.find((node) => node.id === "dave-nutting");
  if (dave) {
    dave.x = width / 2;
    dave.y = height / 2;
  }

  peopleNetwork.simulation = d3.forceSimulation(peopleNetwork.nodes).force(
    "link",
    d3.forceLink(peopleNetwork.links).id((node) => node.id),
  );
  configurePeopleForces(false);
  peopleNetwork.simulation.on("tick", () => {
    links
      .attr("x1", (link) => link.source.x)
      .attr("y1", (link) => link.source.y)
      .attr("x2", (link) => link.target.x)
      .attr("y2", (link) => link.target.y);
    nodes.attr("transform", (node) => `translate(${node.x},${node.y})`);
  });
  nodes.call(
    d3
      .drag()
      .on("start", (event, node) => {
        if (!event.active) peopleNetwork.simulation.alphaTarget(0.22).restart();
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event, node) => {
        if (!event.active) peopleNetwork.simulation.alphaTarget(0);
        node.fx = null;
        node.fy = null;
      }),
  );
  peopleNetwork.svg.on("click", () => {
    if (peopleNetwork.searchOpen) {
      peopleNetwork.searchOpen = false;
      updatePeopleSearchResults();
      return;
    }
    if (peopleNetwork.selectedId) selectPeopleNode(null);
  });

  peopleNetwork.resizeObserver = new ResizeObserver(() => {
    if (!peopleNetwork.root?.isConnected) return;
    const size = peopleGraphDimensions();
    peopleNetwork.svg.attr("width", size.width).attr("height", size.height);
    configurePeopleForces(Boolean(peopleNetwork.selectedId));
    if (peopleNetwork.selectedId) fitSelectedPerson(250);
    else fitPeopleOverview(250);
  });
  peopleNetwork.resizeObserver.observe(stage);
  settlePeopleNetwork(false);
  updatePeopleSearchResults();
}

function destroyPeopleNetwork() {
  clearTimeout(peopleNetwork.settleTimer);
  peopleNetwork.simulation?.stop();
  peopleNetwork.resizeObserver?.disconnect();
  peopleNetwork.root = null;
  peopleNetwork.stage = null;
  peopleNetwork.svg = null;
  peopleNetwork.viewport = null;
  peopleNetwork.linkLayer = null;
  peopleNetwork.nodeLayer = null;
  peopleNetwork.simulation = null;
  peopleNetwork.resizeObserver = null;
  peopleNetwork.nodes = [];
  peopleNetwork.links = [];
  peopleNetwork.selectedId = null;
  peopleNetwork.searchOpen = false;
}

function renderPeople() {
  updateMessageCounter();
  elements.pagination.hidden = true;
  elements.activeFilter.hidden = true;
  if (!state.people.length) {
    elements.content.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent =
      "No people profiles are available. Run npm run people to build the catalog.";
    elements.content.append(empty);
    return;
  }
  if (typeof d3 === "undefined") {
    elements.content.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "The People network library could not be loaded.";
    elements.content.append(empty);
    return;
  }
  if (!peopleNetwork.root?.isConnected) initializePeopleNetwork();
  updatePeopleSearchResults();
  if (state.expandedPerson !== peopleNetwork.selectedId) {
    selectPeopleNode(state.expandedPerson, false);
  } else {
    applyPeopleNetworkFocus();
  }
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
    const comparison =
      typeof leftValue === "string"
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
      state.topicSort.direction =
        state.topicSort.direction === "asc" ? "desc" : "asc";
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
    const person = state.people.find(
      (entry) => entry.id === state.personFilter,
    );
    const relation =
      state.personFilterType === "authored" ? "Authored by" : "Mentions of";
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
    location.hash = state.topic
      ? "topics"
      : state.personFilter
        ? "people"
        : "messages";
  });
  elements.activeFilter.append(label, clear);
  elements.activeFilter.hidden = false;
}

function render() {
  document.body.classList.toggle(
    "people-network-view",
    state.view === "people",
  );
  if (state.view !== "people" && peopleNetwork.root) {
    destroyPeopleNetwork();
  }
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
        count: keyword.messageCount,
      })),
      (keyword) => keyword.term,
      (keyword) => {
        location.hash = `keyword=${encodeURIComponent(keyword.term)}`;
      },
    );
  } else {
    elements.search.placeholder = state.searchBodies
      ? "Search number, sender, subject, or message text"
      : "Search message number, sender, or subject";
    renderMessages();
  }
}

async function loadArchive() {
  const [
    manifestResponse,
    messagesResponse,
    keywordsResponse,
    topicsResponse,
    peopleResponse,
  ] = await Promise.all([
    fetch("data/manifest.json"),
    fetch("data/messages.json"),
    fetch("data/keywords.json"),
    fetch("data/topics.json"),
    fetch("data/people.json").catch(() => null),
  ]);
  if (
    ![
      manifestResponse,
      messagesResponse,
      keywordsResponse,
      topicsResponse,
    ].every((response) => response.ok)
  ) {
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
  if (state.view === "people") {
    peopleNetwork.searchOpen = Boolean(
      state.query || state.peopleEntityFilter,
    );
  }
  state.page = 1;
  clearPreview();
  searchMessageBodies();
  render();
});

elements.search.addEventListener("focus", () => {
  if (
    state.view === "people" &&
    (state.query || state.peopleEntityFilter)
  ) {
    peopleNetwork.searchOpen = true;
    updatePeopleSearchResults();
  }
});

elements.search.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    state.view === "people" &&
    peopleNetwork.searchOpen
  ) {
    event.preventDefault();
    peopleNetwork.searchOpen = false;
    updatePeopleSearchResults();
    elements.search.blur();
  }
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
  if (readerNavigation.scrollFrame !== null) {
    cancelAnimationFrame(readerNavigation.scrollFrame);
    readerNavigation.scrollFrame = null;
  }
  state.previewNumber = null;
  document.documentElement.classList.remove("message-reader-open");
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

elements.messageDialogBody.addEventListener(
  "scroll",
  () => {
    if (readerNavigation.scrollFrame === null) {
      readerNavigation.scrollFrame = requestAnimationFrame(
        syncReaderCurrentMessage,
      );
    }
  },
  { passive: true },
);

function syncChromeHeight() {
  document.documentElement.style.setProperty(
    "--app-chrome-height",
    `${Math.ceil(elements.appChrome.getBoundingClientRect().height)}px`,
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
  elements.settingsArchiveSummary.textContent =
    "Archive data could not be loaded.";
  const message = document.createElement("p");
  message.className = "empty-state";
  message.textContent = `${error.message} Generate the static export before opening this page.`;
  elements.content.replaceChildren(message);
});
