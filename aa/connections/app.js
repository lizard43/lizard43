let graph = null;

const container = document.getElementById('canvas-container');
// Track dynamic responsive window measurements
let width = container.clientWidth;
let height = container.clientHeight;

const svg = d3.select("#network")
    .attr("width", width)
    .attr("height", height);

const viewport = svg.append("g").attr("class", "viewport");

// Zoom bounds tweaked for better pinch mechanics on mobile devices
const zoomBehavior = d3.zoom()
    .scaleExtent([0.1, 3]) 
    .on("zoom", (event) => {
        viewport.attr("transform", event.transform);
    });

svg.call(zoomBehavior);

// Recalculates canvas boundaries automatically if a mobile changes orientation
window.addEventListener('resize', () => {
    width = container.clientWidth;
    height = container.clientHeight;
    svg.attr("width", width).attr("height", height);
});

d3.json("people.json").then(function(loadedData) {
    graph = loadedData;

    const counts = {};
    graph.nodes.forEach(n => counts[n.id] = 0);
    graph.links.forEach(l => {
        const s = l.source.id || l.source;
        const t = l.target.id || l.target;
        if (counts[s] !== undefined) counts[s]++;
        if (counts[t] !== undefined) counts[t]++;
    });

    const simulation = d3.forceSimulation(graph.nodes)
        .force("link", d3.forceLink(graph.links).id(d => d.id).distance(120)) 
        .force("charge", d3.forceManyBody().strength(-300)) 
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("x", d3.forceX(width / 2).strength(0.06)) 
        .force("y", d3.forceY(height / 2).strength(0.06)); 

    const linkGroup = viewport.append("g");
    const linkElements = linkGroup.selectAll("g").data(graph.links).enter().append("g");
    const linkVisible = linkElements.append("line").attr("class", "link-visible");

    const linkInteractive = linkElements.append("line")
        .attr("class", "link-interactive")
        .on("click", function(event, d) {
            clearSelection();
            d3.select(this.nextElementSibling).classed("active", true);
            
            d3.select("#panel-content").html(`
                <div class="meta-label">Connection</div>
                <div class="meta-value">${d.source.id} &rarr; ${d.target.id}</div>
                <div class="meta-label">Edit Annotation</div>
                <input type="text" id="reason-input" value="${d.reason || ''}">
            `);

            document.getElementById('reason-input').addEventListener('input', (e) => {
                d.reason = e.target.value;
            });
            
            openDrawer();
            event.stopPropagation();
        });

    const node = viewport.append("g")
        .selectAll("g").data(graph.nodes)
        .enter().append("g")
        .attr("class", "node-interactive")
        .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

    node.append("circle")
        .attr("class", "node")
        .attr("r", d => 14 + (counts[d.id] || 0) * 2) 
        .attr("fill", "#2d3748");

    node.on("click", function(event, d) {
        clearSelection();
        d3.select(this).classed("active-node", true);
        
        const matches = graph.links.filter(l => 
            l.source.id === d.id || l.target.id === d.id
        );

        let listHtml = "";
        if (matches.length === 0) {
            listHtml = `<div class="placeholder-text">No direct links.</div>`;
        } else {
            matches.forEach(l => {
                const peer = (l.source.id === d.id) ? l.target.id : l.source.id;
                const note = l.reason 
                    ? `<span class="connection-reason">${l.reason}</span>` 
                    : '<span class="placeholder-text">No annotation</span>';
                listHtml += `<div class="connection-item"><strong>${peer}</strong>${note}</div>`;
            });
        }

        const biographicalData = d.bio ? d.bio : "";

        d3.select("#panel-content").html(`
            <div class="meta-value" style="font-size: 20px; font-weight: 700; color: #ffffff; margin-bottom: 2px;">${d.id}</div>
            <div class="meta-value" style="font-size: 13px; font-style: italic; color: #a0aec0; margin-bottom: 14px; line-height: 1.4;">${biographicalData}</div>
            <div class="meta-label" style="border-top: 1px solid #24242b; padding-top: 10px;">Connections</div>
            <div style="margin-top: 4px;">${listHtml}</div>
        `);
        
        openDrawer();
        event.stopPropagation();
    });

    node.append("text")
        .attr("class", "node-text")
        .attr("dy", d => 22 + (counts[d.id] || 0) * 2)
        .text(d => d.id);

    svg.on("click", function() {
        clearSelection();
        closeDrawer();
        d3.select("#panel-content").html(`
            <p class="placeholder-text">Click an item to edit details.</p>
        `);
    });

    simulation.on("tick", () => {
        linkVisible
            .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        linkInteractive
            .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
        node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
    }
    function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
    }
});

function clearSelection() {
    d3.selectAll(".link-visible").classed("active", false);
    d3.selectAll(".node-interactive").classed("active-node", false);
}

// Drawer visibility toggle handlers
function openDrawer() {
    document.getElementById("sidebar").classList.add("drawer-open");
}

function closeDrawer() {
    document.getElementById("sidebar").classList.remove("drawer-open");
}

function exportData() {
    if (!graph) return;
    const cleanLinks = graph.links.map(l => ({
        source: l.source.id || l.source,
        target: l.target.id || l.target,
        reason: l.reason || ""
    }));
    const cleanNodes = graph.nodes.map(n => ({ id: n.id, bio: n.bio || "" }));
    
    const obj = { nodes: cleanNodes, links: cleanLinks };
    const jsonStr = JSON.stringify(obj, null, 2);
    const uri = "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr);
    
    const dl = document.createElement('a');
    dl.setAttribute("href", uri);
    dl.setAttribute("download", "people.json");
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
}
