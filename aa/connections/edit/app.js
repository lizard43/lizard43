// Filename: app.js
// Version: 20260917-173000

let graphData = { nodes: [], links: [] };
let statusTimer = null;
let connectionSort = { key: "source", direction: 1 };
let collapsedGroups = new Set();
let openSource = null;

if ("scrollRestoration" in history) history.scrollRestoration = "manual";

const tableNodesBody = document.getElementById("table-nodes-body");
const tableLinksBody = document.getElementById("table-links-body");
const sectionCountNodes = document.getElementById("section-count-nodes");
const sectionCountLinks = document.getElementById("section-count-links");
const nodeDialog = document.getElementById("node-dialog");
const linkDialog = document.getElementById("link-dialog");
const nodeForm = document.getElementById("node-form");
const linkForm = document.getElementById("link-form");
const selectSource = document.getElementById("link-source");
const selectTarget = document.getElementById("link-target");

async function autoLoadData() {
    try {
        const response = await fetch("../connections.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = await response.json();

        graphData = {
            nodes: Array.isArray(parsed.nodes) ? parsed.nodes.map((n) => ({ id: String(n.id || ""), bio: String(n.bio || "") })) : [],
            links: Array.isArray(parsed.links) ? parsed.links.map((l) => ({
                source: String(l.source || ""),
                target: String(l.target || ""),
                reason: String(l.reason || ""),
                date: String(l.date || "")
            })) : []
        };
        sortData();
        renderLists();
        initializeConnectionGroups();
        renderConnections();
        resetListScroll();
        showStatus("Data loaded from connections.json");
    } catch (error) {
        console.warn("Could not load connections.json.", error);
        renderLists();
        initializeConnectionGroups();
        renderConnections();
        resetListScroll();
        showStatus("No connections.json found. Ready for new entries.");
    }
}

function sortData() {
    graphData.nodes.sort((a, b) => a.id.localeCompare(b.id));
    graphData.links.sort((a, b) => {
        const source = a.source.localeCompare(b.source);
        return source || a.target.localeCompare(b.target);
    });
}

function populateDeveloperSelects(sourceValue = "", targetValue = "") {
    const options = graphData.nodes.map((node) => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.id)}</option>`).join("");
    selectSource.innerHTML = `<option value="">Select source developer</option>${options}`;
    selectTarget.innerHTML = `<option value="">Select target developer</option>${options}`;
    selectSource.value = sourceValue;
    selectTarget.value = targetValue;
}

function renderLists() {
    sortData();
    sectionCountNodes.textContent = graphData.nodes.length;
    if (sectionCountLinks) sectionCountLinks.textContent = graphData.links.length;
    populateDeveloperSelects();
    renderDevelopers();
    renderConnections();
}

function renderDevelopers() {
    tableNodesBody.innerHTML = "";
    if (!graphData.nodes.length) {
        tableNodesBody.innerHTML = `<tr><td colspan="2" class="empty-fallback">No developer nodes loaded.</td></tr>`;
        return;
    }

    graphData.nodes.forEach((node) => {
        const row = document.createElement("tr");
        row.dataset.nodeId = node.id;
        const nameCell = document.createElement("td");
        nameCell.className = "source-cell developer-name-cell";
        nameCell.innerHTML = `<strong>${escapeHtml(node.id)}</strong>`;
        const actions = document.createElement("span");
        actions.className = "row-actions";
        actions.append(createIconButton("Edit developer", "row-icon row-edit", "edit", () => beginNodeEdit(node.id)));
        actions.append(createIconButton("Delete developer", "row-icon row-delete", "delete", () => deleteNode(node.id)));
        nameCell.appendChild(actions);
        row.appendChild(nameCell);
        row.insertAdjacentHTML("beforeend", `<td>${escapeHtml(node.bio)}</td>`);
        tableNodesBody.appendChild(row);
    });
}

function renderConnections() {
    tableLinksBody.innerHTML = "";
    if (!graphData.links.length) {
        tableLinksBody.innerHTML = `<tr><td colspan="4" class="empty-fallback">No connection links loaded.</td></tr>`;
        updateConnectionSortIndicators();
        return;
    }

    const links = [...graphData.links].sort((a, b) => {
        const av = String(a[connectionSort.key] || "").toLocaleLowerCase();
        const bv = String(b[connectionSort.key] || "").toLocaleLowerCase();
        return av.localeCompare(bv) * connectionSort.direction
            || a.source.localeCompare(b.source)
            || a.target.localeCompare(b.target);
    });

    // Source is the primary browse mode: every source is represented by a
    // single collapsed/open row, including sources with exactly one link.
    // Target and Reason keep true duplicate grouping only.
    if (connectionSort.key === "source") {
        const groups = [];
        links.forEach((link) => {
            const previous = groups[groups.length - 1];
            if (!previous || previous.value !== link.source) {
                groups.push({ value: link.source, links: [link] });
            } else {
                previous.links.push(link);
            }
        });

        groups.forEach((group) => {
            const groupKey = `source::${group.value}`;
            const open = openSource === group.value;
            appendSourceGroupRow(group, groupKey, open);
            if (open) {
                group.links.forEach((link) => appendConnectionRow(link, "source"));
            }
        });
    } else {
        const groups = [];
        links.forEach((link) => {
            const value = String(link[connectionSort.key] || "");
            const previous = groups[groups.length - 1];
            if (!previous || previous.value !== value) {
                groups.push({ value, links: [link] });
            } else {
                previous.links.push(link);
            }
        });

        groups.forEach((group) => {
            if (group.links.length === 1) {
                appendConnectionRow(group.links[0]);
                return;
            }
            const groupKey = `${connectionSort.key}::${group.value}`;
            const collapsed = collapsedGroups.has(groupKey);
            appendConnectionGroupRow(group, groupKey, collapsed);
            if (!collapsed) group.links.forEach((link) => appendConnectionRow(link, connectionSort.key));
        });
    }

    updateConnectionSortIndicators();
}

function appendSourceGroupRow(group, groupKey, open) {
    const row = document.createElement("tr");
    row.className = `connection-group-row source-group-row${open ? " is-open" : ""}`;

    const label = group.value || "-";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-toggle";
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.title = open ? "Close source" : "Open source";

    const count = document.createElement("span");
    count.className = "group-count";
    count.textContent = String(group.links.length);

    button.innerHTML = `<span class="group-label">${escapeHtml(label)}</span>`;
    button.appendChild(count);

    if (open) {
        const addButton = createIconButton("Add connection", "group-add-link", "add", () => {
            openLinkDialog(group.value);
        });
        button.appendChild(addButton);
    }

    const sourceCell = document.createElement("td");
    sourceCell.className = "source-cell";
    sourceCell.appendChild(button);
    row.appendChild(sourceCell);
    row.insertAdjacentHTML("beforeend", `<td></td><td></td><td></td>`);

    button.addEventListener("click", (event) => {
        if (event.target.closest(".group-add-link")) return;
        event.stopPropagation();
        openSource = open ? null : group.value;
        collapsedGroups.clear();
        renderConnections();
    });
    tableLinksBody.appendChild(row);
}

function appendConnectionGroupRow(group, groupKey, collapsed) {
    const row = document.createElement("tr");
    row.className = "connection-group-row";

    const cells = ["", "", "", ""];
    const columnIndex = { target: 1, reason: 2 }[connectionSort.key];
    const label = group.value || "-";

    cells[columnIndex] = `
        <button type="button" class="group-toggle" aria-expanded="${collapsed ? "false" : "true"}" title="${collapsed ? "Open" : "Close"} group">
            ${collapsed ? "" : '<span class="group-close" aria-hidden="true">×</span>'}
            <span class="group-label">${escapeHtml(label)}</span>
            <span class="group-count">${group.links.length}</span>
        </button>`;

    row.innerHTML = cells.map((cell) => `<td>${cell}</td>`).join("");
    row.querySelector(".group-toggle").addEventListener("click", () => {
        if (collapsedGroups.has(groupKey)) collapsedGroups.delete(groupKey);
        else collapsedGroups.add(groupKey);
        renderConnections();
    });
    tableLinksBody.appendChild(row);
}

function updateConnectionSortIndicators() {
    document.querySelectorAll(".connection-sort-button").forEach((button) => {
        const active = button.dataset.sort === connectionSort.key;
        button.classList.toggle("active", active);
        button.setAttribute("aria-sort", active ? (connectionSort.direction === 1 ? "ascending" : "descending") : "none");
        const indicator = button.querySelector(".sort-indicator");
        if (indicator) indicator.textContent = active ? (connectionSort.direction === 1 ? " ↑" : " ↓") : "";
    });
}

function initializeConnectionGroups() {
    collapsedGroups.clear();
    openSource = null;
}
function appendConnectionRow(link, omitField = null) {
    const row = document.createElement("tr");
    row.dataset.source = link.source;
    row.dataset.target = link.target;

    const sourceCell = document.createElement("td");
    sourceCell.className = "source-cell";
    if (omitField !== "source") sourceCell.textContent = link.source;

    const actions = document.createElement("span");
    actions.className = "row-actions";
    actions.append(createIconButton("Edit connection", "row-icon row-edit", "edit", () => beginLinkEdit(link.source, link.target)));
    actions.append(createIconButton("Delete connection", "row-icon row-delete", "delete", () => deleteLink(link.source, link.target)));
    sourceCell.appendChild(actions);

    row.appendChild(sourceCell);
    row.insertAdjacentHTML("beforeend", `
        <td>${omitField === "target" ? "" : escapeHtml(link.target)}</td>
        <td>${omitField === "reason" ? "" : escapeHtml(link.reason)}</td>
        <td>${escapeHtml(link.date || "-")}</td>
    `);
    tableLinksBody.appendChild(row);
}

function updateConnectionSort(key) {
    if (connectionSort.key === key) {
        connectionSort.direction *= -1;
    } else {
        connectionSort = { key, direction: 1 };
    }
    initializeConnectionGroups();
    renderConnections();
    resetListScroll();
}

function createButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${className} row-button`;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = iconSvg(label.toLowerCase() === "save" ? "save" : "cancel");
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        handler();
    });
    return button;
}

function createIconButton(label, className, icon, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = iconSvg(icon);
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        handler();
    });
    return button;
}

function iconSvg(icon) {
    if (icon === "delete") {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>';
    }
    if (icon === "save") {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
    }
    if (icon === "cancel") {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
    }
    if (icon === "add") {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.1 2.1 0 0 0-3-3L5 17zM13.5 7.5l3 3"></path></svg>';
}

function beginNodeEdit(nodeId) {
    const node = graphData.nodes.find((item) => item.id === nodeId);
    if (!node) return;

    const row = tableNodesBody.querySelector(`tr[data-node-id="${CSS.escape(nodeId)}"]`);
    if (!row || row.classList.contains("editing")) return;
    row.classList.add("editing");

    row.children[0].innerHTML = `<input class="inline-field" type="text" data-field="id" value="${escapeAttribute(node.id)}">`;
    row.children[1].innerHTML = `<textarea class="inline-field inline-textarea" data-field="bio">${escapeHtml(node.bio)}</textarea>`;

    const actions = document.createElement("span");
    actions.className = "row-actions inline-actions";
    actions.append(createIconButton("Save developer", "row-icon row-save", "save", () => saveNodeEdit(nodeId, row)));
    actions.append(createIconButton("Delete developer", "row-icon row-delete", "delete", () => deleteNode(nodeId)));
    actions.append(createIconButton("Cancel developer edit", "row-icon row-cancel", "cancel", () => renderLists()));
    row.children[0].appendChild(actions);
    row.querySelector("[data-field=id]").focus();
}

function saveNodeEdit(originalId, row) {
    const node = graphData.nodes.find((item) => item.id === originalId);
    if (!node) return;
    const newId = row.querySelector('[data-field="id"]').value.trim();
    const newBio = row.querySelector('[data-field="bio"]').value.trim();

    if (!newId) return showStatus("Developer name cannot be blank.");
    const duplicate = graphData.nodes.some((item) => item !== node && item.id.toLowerCase() === newId.toLowerCase());
    if (duplicate) return showStatus("A developer with that name already exists.");

    const oldId = node.id;
    node.id = newId;
    node.bio = newBio;
    graphData.links.forEach((link) => {
        if (link.source === oldId) link.source = newId;
        if (link.target === oldId) link.target = newId;
    });
    renderLists();
    showStatus("Developer updated.");
}

function beginLinkEdit(source, target) {
    const link = graphData.links.find((item) => item.source === source && item.target === target);
    if (!link) return;
    const row = Array.from(tableLinksBody.rows).find((item) => item.dataset.source === source && item.dataset.target === target);
    if (!row || row.classList.contains("editing")) return;
    row.classList.add("editing");

    const sourceOptions = developerOptions(link.source);
    const targetOptions = developerOptions(link.target);
    row.children[0].innerHTML = `<select class="inline-field inline-select" data-field="source">${sourceOptions}</select>`;
    row.children[1].innerHTML = `<select class="inline-field inline-select" data-field="target">${targetOptions}</select>`;
    row.children[2].innerHTML = `<textarea class="inline-field inline-textarea" data-field="reason">${escapeHtml(link.reason)}</textarea>`;
    row.children[3].innerHTML = `<input class="inline-field" type="text" data-field="date" value="${escapeAttribute(link.date)}">`;

    const actions = document.createElement("span");
    actions.className = "row-actions inline-actions";
    actions.append(createIconButton("Save connection", "row-icon row-save", "save", () => saveLinkEdit(link, row)));
    actions.append(createIconButton("Delete connection", "row-icon row-delete", "delete", () => deleteLinkObject(link)));
    actions.append(createIconButton("Cancel connection edit", "row-icon row-cancel", "cancel", () => renderLists()));
    row.children[0].appendChild(actions);
    row.querySelector('[data-field="source"]').focus();
}

function developerOptions(selected) {
    return graphData.nodes.map((node) => `<option value="${escapeAttribute(node.id)}"${node.id === selected ? " selected" : ""}>${escapeHtml(node.id)}</option>`).join("");
}

function saveLinkEdit(originalLink, row) {
    const source = row.querySelector('[data-field="source"]').value;
    const target = row.querySelector('[data-field="target"]').value;
    const reason = row.querySelector('[data-field="reason"]').value.trim();
    const date = row.querySelector('[data-field="date"]').value.trim();

    if (!source || !target) return showStatus("Both connection endpoints are required.");
    if (source === target) return showStatus("A developer cannot be connected to themselves.");
    const duplicate = graphData.links.some((item) => item !== originalLink && item.source === source && item.target === target);
    if (duplicate) return showStatus("That connection already exists.");

    originalLink.source = source;
    originalLink.target = target;
    originalLink.reason = reason;
    originalLink.date = date;
    renderLists();
    showStatus("Connection updated.");
}

function deleteNode(nodeId) {
    if (!confirm(`Are you sure you want to delete developer "${nodeId}"?`)) return;
    const related = graphData.links.filter((link) => link.source === nodeId || link.target === nodeId).length;
    graphData.nodes = graphData.nodes.filter((node) => node.id !== nodeId);
    if (related && confirm(`"${nodeId}" has ${related} connection(s). Delete those connections too?`)) {
        graphData.links = graphData.links.filter((link) => link.source !== nodeId && link.target !== nodeId);
    }
    renderLists();
    showStatus("Developer removed.");
}

function deleteLinkObject(link) {
    if (!link) return;
    if (!confirm(`Are you sure you want to break the connection between "${link.source}" and "${link.target}"?`)) return;
    graphData.links = graphData.links.filter((item) => item !== link);
    renderLists();
    showStatus("Connection removed.");
}

function deleteLink(source, target) {
    if (!confirm(`Are you sure you want to break the connection between "${source}" and "${target}"?`)) return;
    graphData.links = graphData.links.filter((link) => !(link.source === source && link.target === target));
    renderLists();
    showStatus("Connection removed.");
}

document.getElementById("btn-add-node").addEventListener("click", () => {
    nodeForm.reset();
    updateAddConnectState();
    nodeDialog.showModal();
    setTimeout(() => document.getElementById("node-id").focus(), 0);
});

function openConnectionDialog(sourceValue = "", targetValue = "") {
    linkForm.reset();
    populateDeveloperSelects(sourceValue, targetValue);
    linkDialog.showModal();
    setTimeout(() => (sourceValue ? selectTarget : selectSource).focus(), 0);
}

const nodeIdInput = document.getElementById("node-id");
const addConnectButton = document.getElementById("btn-add-connect");

function updateAddConnectState() {
    const value = nodeIdInput.value.trim();
    const duplicate = graphData.nodes.some((node) => node.id.toLowerCase() === value.toLowerCase());
    if (addConnectButton) addConnectButton.disabled = !value || duplicate;
}

if (nodeIdInput && addConnectButton) {
    nodeIdInput.addEventListener("input", updateAddConnectState);
}

if (addConnectButton) addConnectButton.addEventListener("click", () => {
    const id = nodeIdInput.value.trim();
    const bio = document.getElementById("node-bio").value.trim();
    if (!id) return;
    if (graphData.nodes.some((node) => node.id.toLowerCase() === id.toLowerCase())) {
        showStatus("A developer with that name already exists.");
        return;
    }
    graphData.nodes.push({ id, bio });
    renderLists();
    nodeDialog.close();
    openConnectionDialog(id);
    showStatus(`Developer added. Add a connection for ${id}.`);
});

nodeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = document.getElementById("node-id").value.trim();
    const bio = document.getElementById("node-bio").value.trim();
    if (!id) return showStatus("Developer name cannot be blank.");
    if (graphData.nodes.some((node) => node.id.toLowerCase() === id.toLowerCase())) return showStatus("A developer with that name already exists.");
    graphData.nodes.push({ id, bio });
    renderLists();
    nodeDialog.close();
    showStatus("Developer added.");
});

linkForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const source = selectSource.value;
    const target = selectTarget.value;
    const reason = document.getElementById("link-reason").value.trim();
    const date = document.getElementById("link-date").value.trim();
    if (!source || !target) return showStatus("Both connection endpoints are required.");
    if (source === target) return showStatus("A developer cannot be connected to themselves.");
    if (graphData.links.some((link) => link.source === source && link.target === target)) return showStatus("That connection already exists.");
    graphData.links.push({ source, target, reason, date });
    renderLists();
    linkDialog.close();
    showStatus("Connection added.");
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
        const dialog = document.getElementById(button.dataset.closeDialog);
        if (dialog) dialog.close();
    });
});

[nodeDialog, linkDialog].filter(Boolean).forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
    });
});

document.getElementById("btn-export").addEventListener("click", () => {
    const outputData = {
        nodes: graphData.nodes.map((node) => ({ id: node.id, bio: node.bio })),
        links: graphData.links.map((link) => {
            const item = { source: link.source, target: link.target, reason: link.reason };
            if (link.date) item.date = link.date;
            return item;
        })
    };
    const blob = new Blob([JSON.stringify(outputData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "connections.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showStatus("Export complete.");
});

function showStatus(message) {
    const status = document.getElementById("status-message");
    status.textContent = message;
    status.classList.add("visible");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove("visible"), 3200);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
    return escapeHtml(value);
}

function resetListScroll() {
    document.querySelectorAll(".table-wrap").forEach((wrap) => {
        wrap.scrollTop = 0;
        wrap.scrollLeft = 0;
    });
    window.scrollTo(0, 0);
}

function setActiveView(view, updateHash = true) {
    const showDevelopers = view !== "connections";
    document.getElementById("developers").hidden = !showDevelopers;
    document.getElementById("connections").hidden = showDevelopers;

    document.querySelectorAll(".view-tab").forEach((tab) => {
        const active = tab.dataset.view === (showDevelopers ? "developers" : "connections");
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
    });

    resetListScroll();
    requestAnimationFrame(resetListScroll);
    if (updateHash) history.replaceState(null, "", `#${showDevelopers ? "developers" : "connections"}`);
}

document.querySelectorAll(".connection-sort-button").forEach((button) => {
    button.addEventListener("click", () => updateConnectionSort(button.dataset.sort));
});

document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", (event) => {
        event.preventDefault();
        setActiveView(tab.dataset.view);
    });
});

const initialView = location.hash === "#connections" ? "connections" : "developers";
setActiveView(initialView, false);
autoLoadData();
