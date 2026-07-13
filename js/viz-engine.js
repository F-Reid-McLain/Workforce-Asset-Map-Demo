/* ===== D3.JS NEURAL NETWORK ENGINE ===== */

// Module-level globals — assigned during async init so main.js closures
// capture the variable reference (not the value) and read correctly on use.
let originalSizes = {};
let simulation, svg, zoom, g;
let nodeSelection, linkSelection;

// Asset names run long ("Macon-Bibb County Office of Workforce Development") —
// truncate the always-on label so the map stays scannable; the full name is
// still one hover (native title tooltip) or click (info panel) away.
function truncateLabel(name, maxLen) {
  return name.length > maxLen ? name.slice(0, maxLen - 1).trimEnd() + '…' : name;
}

// Called by main.js when fullscreen state changes
function setWheelZoomEnabled(enabled) {
  zoom.filter(enabled
    ? event => !event.ctrlKey && !event.button
    : event => event.type !== 'wheel' && !event.ctrlKey && !event.button
  );
}

// 1. STRUCTURAL DATA — hub and category nodes stay hardcoded
const structuralNodes = [
  { id: "hub",                name: "Macon Workforce Navigator",          type: "hub",         size: 25, image: "" },
  { id: "colleges",           name: "Colleges",                           type: "major-group", size: 18, image: "", icon: "graduation-cap" },
  { id: "faith-based",        name: "Faith Based",                        type: "major-group", size: 18, image: "", icon: "heart" },
  { id: "special-population", name: "Special Population and Re Entry",    type: "major-group", size: 18, image: "", icon: "users" },
  { id: "job-training",       name: "Job Training and Career Services",   type: "major-group", size: 18, image: "", icon: "briefcase" },
  { id: "community-dev",      name: "Community and Economic Development", type: "major-group", size: 18, image: "", icon: "building" },
  { id: "k12-secondary",      name: "K-12 and Secondary",                 type: "major-group", size: 18, image: "", icon: "book-open" }
];

// Simple Feather/Lucide-style line icons (24x24 viewBox, stroke-based) used
// to give category ("major-group") nodes a purposeful visual instead of a
// blank circle — distinct from the photographic org logos on asset nodes.
const ICON_PATHS = {
  "graduation-cap": [
    "M2 9l10-5 10 5-10 5-10-5z",
    "M6 11.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-4.5",
    "M22 9v6"
  ],
  "heart": [
    "M12 20.5s-7.5-4.6-9.9-9C.4 8 3 4.5 6.6 4.5c2.1 0 3.7 1.4 5.4 3.4 1.7-2 3.3-3.4 5.4-3.4 3.6 0 6.2 3.5 4.5 7-2.4 4.4-9.9 9-9.9 9z"
  ],
  "users": [
    "M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    "M2.5 20c.6-3.4 3.3-6 6.5-6s5.9 2.6 6.5 6",
    "M16.5 6.2c1.4.3 2.5 1.6 2.5 3.1 0 1.5-1.1 2.8-2.5 3.1",
    "M18.5 14.3c2.4.6 4.3 2.7 4.7 5.7"
  ],
  "briefcase": [
    "M3.5 8h17v11h-17z",
    "M8.5 8V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2",
    "M3.5 13.5h17"
  ],
  "building": [
    "M4 21h16",
    "M6 21V9l5-4 5 4v12",
    "M10 21v-5h4v5",
    "M9 11h.01",
    "M13 11h.01",
    "M9 15h.01",
    "M13 15h.01"
  ],
  "book-open": [
    "M12 6.5c-1.8-1.3-4.2-1.8-6.5-1.8-.8 0-1.5.7-1.5 1.5v11c0 .8.7 1.5 1.5 1.5 2.3 0 4.7.5 6.5 1.8",
    "M12 6.5c1.8-1.3 4.2-1.8 6.5-1.8.8 0 1.5.7 1.5 1.5v11c0 .8-.7 1.5-1.5 1.5-2.3 0-4.7.5-6.5 1.8V6.5z"
  ]
};

const structuralLinks = [
  { source: "hub", target: "colleges" },
  { source: "hub", target: "faith-based" },
  { source: "hub", target: "special-population" },
  { source: "hub", target: "job-training" },
  { source: "hub", target: "community-dev" },
  { source: "hub", target: "k12-secondary" }
];

// 2. INITIALIZATION — asset nodes and links built dynamically from assets.json
(async function initViz() {
  let assetsJson = {};
  try {
    const response = await fetch('content/assets.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    assetsJson = await response.json();
  } catch (err) {
    console.error('viz-engine: could not load assets.json', err);
  }

  const assetNodes = Object.entries(assetsJson).map(([id, data]) => ({
    id,
    name: data.name,
    type: "asset",
    size: data.size || 17,
    image: data.image || "",
    tags: data.tags || []
  }));

  const assetLinks = Object.entries(assetsJson)
    .filter(([, data]) => data.category)
    .map(([id, data]) => ({ source: id, target: data.category }));

  const workforceData = {
    nodes: [...structuralNodes, ...assetNodes],
    links: [...structuralLinks, ...assetLinks]
  };

  workforceData.nodes.forEach(node => { originalSizes[node.id] = node.size; });

  const container = d3.select("#network-visualization");
  const width = container.node().getBoundingClientRect().width;
  const height = 612; // Fixed height for consistency

  svg = container.append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${width} ${height}`);

  zoom = d3.zoom()
    .scaleExtent([0.3, 3])
    .filter(event => event.type !== 'wheel' && !event.ctrlKey && !event.button)
    .on("zoom", (event) => { g.attr("transform", event.transform); });
  svg.call(zoom);

  g = svg.append("g");

  const colorScale = d3.scaleOrdinal()
    .domain(["hub", "major-group", "asset"])
    .range(["#ffffff", "#4a9eff", "#66bb6a"]);

  // 3. SIMULATION SETUP
  simulation = d3.forceSimulation(workforceData.nodes)
    .force("link", d3.forceLink(workforceData.links).id(d => d.id).distance(d => {
        return (d.source.type === "hub" || d.target.type === "hub") ? 35 : 130;
    }))
    .force("charge", d3.forceManyBody().strength(-550))
    .force("center", d3.forceCenter(width / 2, height / 2));

  const link = g.append("g").selectAll("line").data(workforceData.links).join("line")
    .attr("stroke", "#666").attr("stroke-width", d => d.source.type === "hub" ? 3 : 1.5).attr("stroke-opacity", 0.6);
  linkSelection = link;

  // Define a clipPath per node so images are clipped to their circle
  const defs = svg.append("defs");
  workforceData.nodes.filter(d => d.image).forEach(d => {
    defs.append("clipPath")
      .attr("id", `clip-${d.id}`)
      .append("circle")
      .attr("r", d.size);
  });

  const node = g.append("g").selectAll("g").data(workforceData.nodes).join("g")
    .call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended));
  nodeSelection = node;

  node.append("circle").attr("r", d => d.size).attr("fill", d => d.image ? "#ffffff" : colorScale(d.type)).attr("stroke", "#fff")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", d => d.type === "asset" && !d.image ? "5,5" : "0")
    .attr("opacity", 0.9);

  // Render a themed icon inside category ("major-group") nodes so they read
  // as purposeful, distinct from both the plain hub and the asset logos
  node.filter(d => d.icon && ICON_PATHS[d.icon])
    .each(function (d) {
      const iconWidth = d.size * 1.4; // ~70% of the circle's diameter (d.size*2)
      const scale = iconWidth / 24;   // icon paths are drawn in a 24x24 viewBox
      d3.select(this).append("g")
        .attr("class", "node-icon")
        .attr("transform", `translate(${-12 * scale},${-12 * scale}) scale(${scale})`)
        .attr("fill", "none")
        .attr("stroke", "#fff")
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .selectAll("path")
        .data(ICON_PATHS[d.icon])
        .join("path")
        .attr("d", p => p);
    });

  // Hub node gets an "MWN" wordmark instead of a photo logo or category icon
  node.filter(d => d.type === "hub")
    .append("text")
    .attr("class", "node-hub-mark")
    .text("MWN")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("fill", "#4a9eff")
    .attr("font-weight", "700")
    .attr("font-size", d => d.size * 0.62)
    .attr("letter-spacing", "0.02em");

  // Render logo inside circle for nodes that have an image
  node.filter(d => d.image)
    .append("image")
    .attr("href", d => d.image)
    .attr("x", d => -d.size)
    .attr("y", d => -d.size)
    .attr("width",  d => d.size * 2)
    .attr("height", d => d.size * 2)
    .attr("clip-path", d => `url(#clip-${d.id})`)
    .attr("preserveAspectRatio", "xMidYMid slice");

  node.append("text").attr("class", "node-label")
    .text(d => d.type === "asset" ? truncateLabel(d.name, 24) : d.name)
    .attr("dy", d => d.size + 18).attr("text-anchor", "middle").attr("fill", "#fff")
    .attr("font-size", d => d.type === "hub" ? "14px" : "11px").style("text-shadow", "1px 1px 2px rgba(0,0,0,0.8)");

  // Native tooltip so a truncated asset name is still readable on hover
  node.filter(d => d.type === "asset").append("title").text(d => d.name);

  // 4. INTERACTION
  node.on("mouseover", function() { d3.select(this).select("circle").attr("stroke-width", 4).attr("filter", "brightness(1.3)"); })
      .on("mouseout", function() { d3.select(this).select("circle").attr("stroke-width", 2).attr("filter", "none"); })
      .on("click", (_e, d) => { if (d.type === "asset") openAssetModal(d.id); })
      .style("cursor", d => d.type === "asset" ? "pointer" : "default");

  simulation.on("tick", () => {
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  function dragstarted(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  function dragended(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }
})();
