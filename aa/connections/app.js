let graph = null;

const container = document.getElementById('canvas-container');
const width = container.clientWidth;
const height = container.clientHeight;

const svg = d3.select("#network")
    .attr("width", width)
    .attr("height", height);

// 1. ADD INNER VIEWPORT CONTAINER GROUP FOR PAN/ZOOM
const viewport = svg.append("g").attr("class", "viewport");

// 2. CONFIGURE D3 ZOOM ENGINE WITH REASONABLE CONSTRAINTS
const zoomBehavior = d3.zoom()
    .scaleExtent([0.15, 3]) // Prevent zooming into infinity or completely out of view
    .on("zoom", (event) => {
        viewport.attr("transform", event.transform);
    });

svg.call(zoomBehavior);

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

    // 3. TIGHTEN FORCES AND STRENGTH TO KEEP EXTENTS SCANNABLE
    const simulation = d3.forceSimulation(graph.nodes)
        .force("link", d3.forceLink(graph.links)
            .id(d => d.id)
            .distance(110)) // Shortened from 160 to pack tightly
        .force("charge", d3.forceManyBody().strength(-350)) // Adjusted from -500 to compress clustering
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("x", d3.forceX(width / 2).strength(0.08)) // Added gravity walls to pull runaway 
        .force("y", d3.forceY(height / 2).strength(0.08)); // nodes back into the center screen

    // NOTE: Elements are appended directly onto the "viewport" group now, NOT the base svg
    const linkGroup = viewport.append("g");
    
    const linkElements = linkGroup.selectAll("g")
        .data(graph.links).enter().append("g");
        
    const linkVisible = linkElements.append("line")
        .attr("class", "link-visible");

    const linkInteractive = linkElements.append("line")
        .attr("class", "link-interactive")
        .on("click", function(event, d) {
            clearSelection();
            d3.select(this.nextElementSibling)
                .classed("active", true);
            
            d3.select("#panel-content").html(`
                <div class="meta-label">Type</div>
                <div class="meta-value">Connection</div>
                <div class="meta-label">Path</div>
                <div class="meta-value">
                    ${d.source.id} &rarr; ${d.target.id}
                </div>
                <div class="meta-label">Edit Annotation</div>
                <input type="text" id="reason-input" 
                    value="${d.reason || ''}">
            `);

            document.getElementById('reason-input')
                .addEventListener('input', (e) => {
                    d.reason = e.target.value;
                });
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
        .attr("r", d => 14 + (counts[d.id] || 0) * 2.5) // Slightly scaled down layout radii
        .attr("fill", "#2d3748");

    node.on("click", function(event, d) {
        clearSelection();
        d3.select(this).classed("active-node", true);
        
        const matches = graph.links.filter(l => 
            l.source.id === d.id || l.target.id === d.id
        );

        let listHtml = "";
        if (matches.length === 0) {
            listHtml = `<div class="placeholder-text">
                No active relationships mapped.
            </div>`;
        } else {
            matches.forEach(l => {
                const peer = (l.source.id === d.id) 
                    ? l.target.id : l.source.id;
                const note = l.reason 
                    ? ` - <span class="connection-reason">${l.reason}</span>` 
                    : ' - <span class="placeholder-text">No annotation</span>';
                listHtml += `<div class="connection-item">
                    <strong>${peer}</strong>${note}
                </div>`;
            });
        }

        d3.select("#panel-content").html(`
            <div class="meta-value" style="font-size: 18px; 
                font-weight: 600; color: #ffffff; 
                margin-bottom: 5px;">${d.id}</div>
            <div class="meta-label" style="border-top: 1px 
                solid #24242b; padding-top: 5px;"></div>
            <div style="margin-top: 4px;">${listHtml}</div>
        `);
        event.stopPropagation();
    });

    node.append("text")
        .attr("class", "node-text")
        .attr("dy", d => 24 + (counts[d.id] || 0) * 2.5)
        .text(d => d.id);

    // Clicking empty space resets layout selection
    svg.on("click", function() {
        clearSelection();
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

    // 4. FIX DRAG STATES BY MULTIPLYING COORDINATES BY EVENT TRANSFORM CONSTRAINTS
    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; 
        d.fy = d.y;
    }
    function dragged(event, d) { 
        d.fx = event.x; 
        d.fy = event.y; 
    }
    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; 
        d.fy = null;
    }
});

function clearSelection() {
    d3.selectAll(".link-visible").classed("active", false);
    d3.selectAll(".node-interactive").classed("active-node", false);
}

function exportData() {
    if (!graph) return;
    const cleanLinks = graph.links.map(l => ({
        source: l.source.id || l.source,
        target: l.target.id || l.target,
        reason: l.reason || ""
    }));
    const cleanNodes = graph.nodes.map(n => ({ id: n.id }));
    
    const obj = { nodes: cleanNodes, links: cleanLinks };
    const jsonStr = JSON.stringify(obj, null, 2);
    const uri = "data:text/json;charset=utf-8," + 
        encodeURIComponent(jsonStr);
    
    const dl = document.createElement('a');
    dl.setAttribute("href", uri);
    dl.setAttribute("download", "people.json");
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
}
