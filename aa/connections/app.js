// app.js
// Version 20260916-1920
let graph = null;
let simulation = null;
let selectedNode = null;
let recentNode = null;
let width = 0;
let height = 0;
let hasInteracted = false;
let isMobile = window.matchMedia("(max-width: 767px)").matches;

const container = document.getElementById("canvas-container");
const svg = d3.select("#network");
const viewport = svg.append("g").attr("class", "viewport");
const linkLayer = viewport.append("g").attr("class", "links");
const nodeLayer = viewport.append("g").attr("class", "nodes");

const zoomBehavior = d3.zoom()
    .scaleExtent([0.16, 4])
    .filter(event => event.type === "wheel" || event.type === "mousedown" || event.type === "touchstart" || event.type === "dblclick")
    .on("zoom", event => { viewport.attr("transform", event.transform); updateLabelVisibility(); });

svg.call(zoomBehavior).on("dblclick.zoom", null);

const panelContent = document.getElementById("panel-content");
const sidebar = document.getElementById("sidebar");
const searchOverlay = document.getElementById("search-overlay");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");

function esc(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function nodeId(endpoint) {
    return typeof endpoint === "object" ? endpoint.id : endpoint;
}

function directLinks(id) {
    if (!graph) return [];
    return graph.links.filter(link => nodeId(link.source) === id || nodeId(link.target) === id);
}

function peerFor(link, id) {
    return nodeId(link.source) === id ? nodeId(link.target) : nodeId(link.source);
}

function connectionFor(a, b) {
    return graph.links.find(link => {
        const s = nodeId(link.source);
        const t = nodeId(link.target);
        return (s === a && t === b) || (s === b && t === a);
    });
}

function setDimensions() {
    width = container.clientWidth;
    height = container.clientHeight;
    svg.attr("width", width).attr("height", height);
    isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (simulation) {
        simulation
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("x", d3.forceX(d => d._isolated ? width * 0.12 : width / 2).strength(isMobile ? 0.022 : 0.045))
            .force("y", d3.forceY(d => d._isolated ? height * 0.13 : height / 2).strength(isMobile ? 0.022 : 0.045));
        simulation.alpha(0.12).restart();
    }
}

function showHint() {
    document.getElementById("canvas-hint").classList.toggle("hidden", hasInteracted || !!selectedNode);
}

function markInteracted() {
    hasInteracted = true;
    showHint();
}

function clearSelection(closePanel = true, restoreView = false) {
    if (selectedNode) recentNode = selectedNode;
    selectedNode = null;
    applyNodeFocus();
    if (closePanel) {
        sidebar.classList.remove("drawer-open", "has-selection");
    }
    showHint();
    if (restoreView) {
        requestAnimationFrame(() => requestAnimationFrame(() => expandNetworkView()));
    }
}

function restoreInitialView() {
    const initialScale = 0.82;
    const dave = graph && graph.nodes.find(n => n.id === "David J. Nutting");

    if (dave && Number.isFinite(dave.x) && Number.isFinite(dave.y)) {
        centerOnNode(dave, initialScale, isMobile ? height * 0.45 : height / 2);
        return;
    }

    svg.interrupt().transition().duration(650).ease(d3.easeCubicOut)
        .call(zoomBehavior.transform,
            d3.zoomIdentity
                .translate(width * (1 - initialScale) / 2, height * (1 - initialScale) / 2)
                .scale(initialScale)
        );
}

function applyNodeFocus() {
    const focusId = selectedNode ? selectedNode.id : null;
    const recentId = !focusId && recentNode ? recentNode.id : null;
    const peers = new Set(focusId ? directLinks(focusId).map(link => peerFor(link, focusId)) : []);

    nodeLayer.selectAll(".node-interactive")
        .classed("active-node", d => d.id === focusId)
        .classed("recent-node", d => d.id === recentId)
        .classed("related-node", d => peers.has(d.id) && d.id !== focusId)
        .classed("dimmed", d => !!focusId && d.id !== focusId && !peers.has(d.id));

    linkLayer.selectAll(".link-visible")
        .classed("related", link => !!focusId && (nodeId(link.source) === focusId || nodeId(link.target) === focusId))
        .classed("dimmed", link => !!focusId && nodeId(link.source) !== focusId && nodeId(link.target) !== focusId)
        .classed("active", false);
}

function openPerson(node, center = false) {
    if (!node) return;
    selectedNode = node;
    recentNode = null;
    hasInteracted = true;
    applyNodeFocus();
    renderPersonPanel(node);
    sidebar.classList.add("drawer-open", "has-selection");
    showHint();
    if (center || isMobile) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (simulation) simulation.stop();
            centerOnNode(node, isMobile ? 0.78 : 0.72, isMobile ? getMobileGraphCenterY() : height / 2);
        }));
    }
}

function renderPersonPanel(node) {
    const links = directLinks(node.id).sort((a, b) => {
        const aName = peerFor(a, node.id);
        const bName = peerFor(b, node.id);
        return aName.localeCompare(bName);
    });

    const items = links.map(link => {
        const peerId = peerFor(link, node.id);
        return `
            <button class="connection-item" type="button" data-peer="${esc(peerId)}">
                <span class="connection-arrow">›</span>
                <span class="connection-name">${esc(peerId)}</span>
                <span class="connection-reason">${esc(link.reason || "No annotation")}</span>
            </button>`;
    }).join("");

    panelContent.innerHTML = `
        <article class="person-card">
            <h1 class="person-name">${esc(node.id)}</h1>
            <p class="person-role">${esc(node.bio || "No biographical note is currently recorded.")}</p>
            <div class="stat-row"><span class="stat-dot"></span>${links.length} connection${links.length === 1 ? "" : "s"}</div>
            <div class="connection-list">${items || '<div class="empty-card">No connections are recorded for this person.</div>'}</div>
        </article>`;

    panelContent.querySelectorAll(".connection-item").forEach(button => {
        button.addEventListener("click", () => {
            const peerNode = graph.nodes.find(item => item.id === button.dataset.peer);
            if (peerNode) openPerson(peerNode, true);
        });
    });
}

function getMobileGraphCenterY() {
    if (!isMobile) return height / 2;
    const sheet = document.getElementById("sidebar");
    if (!sheet || !sheet.classList.contains("drawer-open")) return height / 2;
    const sheetHeight = sheet.getBoundingClientRect().height;
    return Math.max(100, (height - sheetHeight) / 2);
}

function getDesktopGraphCenterX() {
    if (isMobile) return width / 2;
    const sheet = document.getElementById("sidebar");
    if (!sheet || !sheet.classList.contains("drawer-open")) return width / 2;
    const sheetWidth = sheet.getBoundingClientRect().width;
    return Math.max(120, (width - sheetWidth) / 2);
}

function centerOnNode(node, scale = 0.72, targetY = height / 2) {
    if (!node) return;
    const targetX = isMobile ? width / 2 : getDesktopGraphCenterX();
    const tx = targetX - node.x * scale;
    const ty = targetY - node.y * scale;
    svg.interrupt().transition().duration(650).ease(d3.easeCubicOut).call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

function expandNetworkView() {
    if (!graph || !simulation) return;

    simulation
        .force("link").distance(isMobile ? 128 : 150)
        .strength(isMobile ? .52 : .64);
    simulation
        .force("charge").strength(isMobile ? -340 : -390);
    simulation
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("x", d3.forceX(d => d._isolated ? width * 0.12 : width / 2).strength(isMobile ? .016 : .055))
        .force("y", d3.forceY(d => d._isolated ? height * 0.12 : height / 2).strength(isMobile ? .014 : .055));

    simulation.alpha(0.8).restart();

    setTimeout(() => {
        simulation.stop();
        fitNetwork(650);
    }, 650);
}

function fitNetwork(duration = 700) {
    if (!graph || !graph.nodes.length) return;
    const nodes = graph.nodes.filter(n => !n._isolated && Number.isFinite(n.x) && Number.isFinite(n.y));
    if (!nodes.length) return;

    const pad = isMobile ? 72 : 80;
    const minX = d3.min(nodes, n => n.x);
    const maxX = d3.max(nodes, n => n.x);
    const minY = d3.min(nodes, n => n.y);
    const maxY = d3.max(nodes, n => n.y);
    const graphW = Math.max(1, maxX - minX);
    const graphH = Math.max(1, maxY - minY);
    const usableH = height;
    const scale = Math.max(0.2, Math.min(1.15, Math.min((width - pad * 2) / graphW, (usableH - pad * 2) / graphH)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const tx = width / 2 - cx * scale;
    const targetY = isMobile ? usableH / 2 : height / 2;
    const ty = targetY - cy * scale;
    svg.interrupt().transition().duration(duration).ease(d3.easeCubicOut).call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}
function renderSearchResults(query = "") {
    if (!graph) return;
    const q = query.trim().toLowerCase();
    const matches = graph.nodes
        .filter(node => !q || node.id.toLowerCase().includes(q))
        .sort((a, b) => {
            if (!q) return a.id.localeCompare(b.id);
            const aStarts = a.id.toLowerCase().startsWith(q);
            const bStarts = b.id.toLowerCase().startsWith(q);
            return Number(bStarts) - Number(aStarts) || a.id.localeCompare(b.id);
        });

    if (!matches.length) {
        searchResults.innerHTML = `<div class="search-empty">No people match “${esc(query)}”.</div>`;
        return;
    }

    let lastLetter = "";
    searchResults.innerHTML = matches.map(node => {
        const letter = node.id.charAt(0).toUpperCase();
        const heading = !q && letter !== lastLetter ? (lastLetter = letter, `<div class="directory-group">${esc(letter)}</div>`) : "";
        return `${heading}<button class="result-item" type="button" data-person="${esc(node.id)}"><span class="result-name">${esc(node.id)}</span><span class="result-bio">${esc(node.bio || "")}</span></button>`;
    }).join("");

    searchResults.querySelectorAll(".result-item").forEach(button => {
        button.addEventListener("click", () => {
            const node = graph.nodes.find(n => n.id === button.dataset.person);
            closeOverlay(searchOverlay);
            openPerson(node, true);
        });
    });
}

function openOverlay(overlay) {
    overlay.removeAttribute("inert");
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    if (overlay === searchOverlay) {
        searchInput.value = "";
        renderSearchResults();
        updateSearchClear();
        requestAnimationFrame(() => searchInput.focus());
    }
}

function closeOverlay(overlay) {
    if (overlay.contains(document.activeElement)) {
        document.getElementById("search-btn").focus();
    }
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("inert", "");
}

function updateSearchClear() {
    const clear = document.getElementById("search-clear");
    if (clear) clear.hidden = !searchInput.value;
}

function dragstarted(event, d) {
    markInteracted();
    if (!event.active) simulation.alphaTarget(0.25).restart();
    d.fx = d.x;
    d.fy = d.y;
}
function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

function updateLabelVisibility() {
    if (!graph) return;
    const nodes = graph.nodes.filter(n => Number.isFinite(n.x) && Number.isFinite(n.y));
    const zoomScale = currentZoomScale();
    const threshold = isMobile ? (zoomScale < 0.72 ? 48 : 40) : 34;
    const ordered = [...nodes].sort((a, b) => {
        const aPriority = (selectedNode && a.id === selectedNode.id ? 1000 : 0) + (selectedNode && directLinks(selectedNode.id).some(l => peerFor(l, selectedNode.id) === a.id) ? 500 : 0) + (graph.links.filter(l => nodeId(l.source) === a.id || nodeId(l.target) === a.id).length * 5);
        const bPriority = (selectedNode && b.id === selectedNode.id ? 1000 : 0) + (selectedNode && directLinks(selectedNode.id).some(l => peerFor(l, selectedNode.id) === b.id) ? 500 : 0) + (graph.links.filter(l => nodeId(l.source) === b.id || nodeId(l.target) === b.id).length * 5);
        return bPriority - aPriority;
    });
    const visible = [];
    ordered.forEach(node => {
        const selectedForced = selectedNode && (node.id === selectedNode.id || directLinks(selectedNode.id).some(l => peerFor(l, selectedNode.id) === node.id));
        const degree = graph.links.filter(l => nodeId(l.source) === node.id || nodeId(l.target) === node.id).length;
        // Keep the two anchors of the network named even when nearby labels compete for space.
        // High-connectivity people also get a stronger claim on a label; low-degree labels are
        // the ones we hide first when the graph is crowded.
        const anchorForced = node.id === "David J. Nutting" || node.id === "Bob Ogdon";
        const important = degree >= 4;
        const clear = visible.every(other => Math.hypot(node.x - other.x, node.y - other.y) >= threshold);
        if (selectedForced || anchorForced || important || clear || zoomScale >= 1.15) visible.push(node);
    });
    nodeLayer.selectAll(".node-interactive .node-text")
        .style("display", d => visible.includes(d) ? null : "none");
}

function currentZoomScale() {
    const t = d3.zoomTransform(svg.node());
    return t.k || 1;
}

function buildGraph() {
    const counts = Object.fromEntries(graph.nodes.map(node => [node.id, 0]));
    graph.links.forEach(link => {
        counts[nodeId(link.source)]++;
        counts[nodeId(link.target)]++;
    });

    const connectedIds = new Set();
    graph.links.forEach(link => {
        connectedIds.add(nodeId(link.source));
        connectedIds.add(nodeId(link.target));
    });
    graph.nodes.forEach((node, i) => {
        node._isolated = !connectedIds.has(node.id);
        const angle = i * Math.PI * (3 - Math.sqrt(5));
        const radius = Math.sqrt(i + 1);
        const rx = Math.min(width * 0.34, 230);
        const ry = Math.min(height * 0.34, 280);
        node.x = width / 2 + Math.cos(angle) * radius * (rx / Math.sqrt(graph.nodes.length));
        node.y = height / 2 + Math.sin(angle) * radius * (ry / Math.sqrt(graph.nodes.length));
        if (node._isolated) {
            node.x = width * 0.12;
            node.y = height * 0.13;
        }
    });

    simulation = d3.forceSimulation(graph.nodes)
        .force("link", d3.forceLink(graph.links).id(d => d.id).distance(isMobile ? 104 : 124).strength(isMobile ? .48 : .60))
        .force("charge", d3.forceManyBody().strength(isMobile ? -245 : -300).distanceMax(isMobile ? 620 : Infinity))
        .force("collide", d3.forceCollide().radius(d => {
            const labelSpace = isMobile ? Math.min(58, d.id.length * 1.9) : Math.min(34, d.id.length * 1.15);
            return 18 + Math.min(10, counts[d.id] * 1.25) + labelSpace;
        }).strength(.96))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("x", d3.forceX(d => d._isolated ? width * 0.12 : width / 2).strength(isMobile ? .012 : .045))
        .force("y", d3.forceY(d => d._isolated ? height * 0.12 : height / 2).strength(isMobile ? .010 : .045));

    const linkGroups = linkLayer.selectAll("g.link-group")
        .data(graph.links)
        .enter().append("g")
        .attr("class", "link-group");

    linkGroups.append("line").attr("class", "link-visible");
    linkGroups.append("line")
        .attr("class", "link-interactive")
        .attr("aria-hidden", "true");

    const nodes = nodeLayer.selectAll("g.node-interactive")
        .data(graph.nodes)
        .enter().append("g")
        .attr("class", "node-interactive")
        .call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended))
        .on("click", (event, node) => {
            markInteracted();
            openPerson(node, false);
            event.stopPropagation();
        });

    nodes.append("circle").attr("class", "node-halo").attr("r", d => 14 + Math.min(15, counts[d.id] * 2));
    nodes.append("circle")
        .attr("class", "node")
        .attr("r", d => 9 + Math.min(10, counts[d.id] * 1.7));
    nodes.append("text")
        .attr("class", "node-text")
        .attr("dy", d => 18 + Math.min(11, counts[d.id] * 1.2))
        .text(d => d.id);

    svg.on("click", () => {
        if (selectedNode) clearSelection(true);
        markInteracted();
    });

    simulation.on("tick", () => {
        linkLayer.selectAll(".link-visible, .link-interactive")
            .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        nodeLayer.selectAll(".node-interactive").attr("transform", d => `translate(${d.x},${d.y})`);
    });

}

function wireUI() {
    document.getElementById("search-btn").addEventListener("click", () => openOverlay(searchOverlay));
    document.getElementById("fit-btn").addEventListener("click", () => { markInteracted(); fitNetwork(); });
    document.getElementById("sidebar-close").addEventListener("click", () => clearSelection(true, true));
    document.getElementById("search-clear").addEventListener("click", () => { searchInput.value = ""; renderSearchResults(); updateSearchClear(); searchInput.focus(); });
    searchInput.addEventListener("input", () => { renderSearchResults(searchInput.value); updateSearchClear(); });

    document.querySelectorAll("[data-close-overlay]").forEach(element => {
        element.addEventListener("click", () => closeOverlay(document.getElementById(element.dataset.closeOverlay)));
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeOverlay(searchOverlay);
            clearSelection(true, true);
        }
        if (event.key === "/" && document.activeElement !== searchInput) {
            event.preventDefault();
            openOverlay(searchOverlay);
        }
    });

    let resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            setDimensions();
        }, 80);
    });
}

setDimensions();
wireUI();

fetch("connections.json")
    .then(response => {
        if (!response.ok) throw new Error(`Unable to load (${response.status})`);
        return response.json();
    })
    .then(data => {
        graph = data;
        document.getElementById("network-count").textContent = `${graph.nodes.length} PEOPLE · ${graph.links.length} LINKS`;
        buildGraph();
        const dave = graph.nodes.find(n => n.id === "David J. Nutting");
        const initialScale = isMobile ? 0.82 : 0.82;
        svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(width * (1 - initialScale) / 2, height * (1 - initialScale) / 2).scale(initialScale));
        if (dave) centerOnNode(dave, initialScale, isMobile ? height * 0.45 : height / 2);
        showHint();
    })
    .catch(error => {
        console.error(error);
        panelContent.innerHTML = `<div class="empty-card">The network data could not be loaded.</div>`;
    });
