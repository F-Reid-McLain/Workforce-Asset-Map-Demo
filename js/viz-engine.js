/* ===== D3.JS NEURAL NETWORK ENGINE ===== */

// Module-level globals — assigned during async init so main.js closures
// capture the variable reference (not the value) and read correctly on use.
let originalSizes = {};
let simulation, svg, zoom, g;
let nodeSelection, linkSelection;
let workforceData; // hoisted so main.js can re-fit the view (e.g. on Reset)

// Fixed hue per category — CVD-checked as a set (see dataviz palette) — used
// for major-group node fill and as the glow/link tint for everything under it,
// so the map reads as six identifiable neighborhoods instead of one blue blob.
const CATEGORY_COLORS = {
  "colleges":            "#3987e5",
  "faith-based":         "#199e70",
  "special-population":  "#c98500",
  "job-training":        "#008300",
  "community-dev":       "#9085e9",
  "k12-secondary":       "#e66767"
};

// Applied as an attribute (not a CSS rule) so it composes with the hover
// handler's inline "filter" attribute below instead of being silently
// out-prioritized by it — presentation attributes and inline JS .attr()
// calls share the same low cascade tier, but a stylesheet rule would win
// over both and break the hover brighten.
const GLOW_FILTER = "drop-shadow(0 0 1px currentColor) drop-shadow(0 0 4px currentColor)";

// Simulation never fully cools to this floor instead of 0, so the graph
// keeps a faint perpetual drift at rest instead of freezing solid.
// main.js's drag handler restores this same value on drag-end.
const IDLE_ALPHA_TARGET = 0.008;

// Asset names run long ("Macon-Bibb County Office of Workforce Development") —
// truncate the always-on label so the map stays scannable; the full name is
// still one hover (native title tooltip) or click (info panel) away.
function truncateLabel(name, maxLen) {
  return name.length > maxLen ? name.slice(0, maxLen - 1).trimEnd() + '…' : name;
}

// Computes the zoom transform that frames every current node within a
// width x height viewport, so the default/reset view shows the whole graph
// instead of whatever the force layout happened to center on.
function computeFitTransform(width, height, padding = 60) {
  if (!workforceData || !workforceData.nodes.length) return d3.zoomIdentity;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  workforceData.nodes.forEach(d => {
    const r = d.size + 20; // clear the label hanging below each node
    minX = Math.min(minX, d.x - r);
    maxX = Math.max(maxX, d.x + r);
    minY = Math.min(minY, d.y - r);
    maxY = Math.max(maxY, d.y + r + 16); // label text sits below the node
  });
  const graphWidth = Math.max(maxX - minX, 1);
  const graphHeight = Math.max(maxY - minY, 1);
  const scale = Math.min((width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight, 1);
  const tx = width / 2 - scale * (minX + maxX) / 2;
  const ty = height / 2 - scale * (minY + maxY) / 2;
  return d3.zoomIdentity.translate(tx, ty).scale(scale);
}

// Called on load and by main.js's Reset View so the graph re-frames to fit
// the current container instead of resetting to an arbitrary 1:1 view.
function fitVizView(duration = 0) {
  if (!svg || !zoom) return;
  const r = document.getElementById('network-visualization').getBoundingClientRect();
  const transform = computeFitTransform(r.width, r.height);
  if (duration > 0) svg.transition().duration(duration).call(zoom.transform, transform);
  else svg.call(zoom.transform, transform);
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
    category: data.category || "",
    size: data.size || 17,
    image: data.image || "",
    logoFit: data.logoFit || "cover",
    logoBg: data.logoBg || "",
    placeholder: data.placeholder || "",
    tags: data.tags || []
  }));

  const assetLinks = Object.entries(assetsJson)
    .filter(([, data]) => data.category)
    .map(([id, data]) => ({ source: id, target: data.category }));

  workforceData = {
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

  // The node's own circle color — logos keep a neutral backing plate (their
  // own logoBg, or white) so the artwork stays legible; everything else takes
  // its category's hue so the six neighborhoods are visually distinct.
  function fillColor(d) {
    if (d.logoBg) return d.logoBg;
    if (d.image) return "#ffffff";
    if (d.type === "hub") return "#ffffff";
    if (d.type === "major-group") return CATEGORY_COLORS[d.id] || colorScale(d.type);
    return CATEGORY_COLORS[d.category] || colorScale(d.type);
  }

  // The color the CSS glow (drop-shadow currentColor) reads — tracks the
  // category hue even for logo nodes, so the glow still marks which
  // neighborhood a photographic logo belongs to.
  function glowColor(d) {
    if (d.type === "hub") return "#4a9eff";
    if (d.type === "major-group") return CATEGORY_COLORS[d.id] || "#4a9eff";
    return CATEGORY_COLORS[d.category] || "#66bb6a";
  }

  // Hops from the hub — hub itself, its six categories, then leaf assets.
  // Drives both the on-load reveal stagger and which way particles flow.
  function depthOf(d) { return d.type === "hub" ? 0 : d.type === "major-group" ? 1 : 2; }

  const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 3. SIMULATION SETUP
  simulation = d3.forceSimulation(workforceData.nodes)
    .force("link", d3.forceLink(workforceData.links).id(d => d.id).distance(d => {
        return (d.source.type === "hub" || d.target.type === "hub") ? 35 : 130;
    }))
    .force("charge", d3.forceManyBody().strength(-550))
    .force("center", d3.forceCenter(width / 2, height / 2))
    // Keeps nodes (and the labels hanging below them) from overlapping —
    // padding is generous since it has to clear the label text, not just the circle.
    .force("collide", d3.forceCollide(d => d.size + 34).strength(0.8));

  // Warm-start: run the layout to near-equilibrium synchronously before the
  // first paint, so the initial fit-to-view (below) frames settled positions
  // instead of the starting jumble.
  simulation.stop();
  for (let i = 0; i < 300; i++) simulation.tick();

  // A link's color follows whichever end is the category node — asset links
  // read as belonging to their category's color, hub links stay accent blue.
  function linkColor(d) {
    if (d.source.type === "hub" || d.target.type === "hub") return "#4a9eff";
    const catNode = d.source.type === "major-group" ? d.source : d.target;
    return CATEGORY_COLORS[catNode.id] || "#666";
  }

  const link = g.append("g").selectAll("line").data(workforceData.links).join("line")
    .attr("stroke", linkColor)
    .attr("stroke-width", d => d.source.type === "hub" ? 3 : 1.5)
    .attr("stroke-opacity", d => d.source.type === "hub" || d.target.type === "hub" ? 0.55 : 0.4);
  linkSelection = link;

  // Small dots that continuously travel each link toward the hub, reading as
  // activity/energy flowing into the network — skipped under reduced-motion.
  const PARTICLE_PERIOD = 2600; // ms for one full travel down a link
  let particle = null;
  if (!prefersReducedMotion) {
    workforceData.links.forEach(d => {
      // Always flow from the farther-from-hub end toward the nearer end.
      d.__flowFrom = depthOf(d.source) > depthOf(d.target) ? d.source : d.target;
      d.__flowTo   = d.__flowFrom === d.source ? d.target : d.source;
      d.__phase    = Math.random() * PARTICLE_PERIOD; // desyncs the dots
    });
    particle = g.append("g").selectAll("circle").data(workforceData.links).join("circle")
      .attr("r", 2.5)
      .attr("fill", linkColor)
      .attr("opacity", 0);
  }

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

  node.append("circle").attr("r", d => d.size).attr("fill", fillColor).attr("stroke", "#fff")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", d => d.type === "asset" && !d.image && !d.placeholder ? "5,5" : "0")
    .attr("opacity", 0.9)
    .style("color", glowColor)
    .attr("filter", GLOW_FILTER);

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

  // "Other" catch-all nodes get an ellipsis instead of a photo logo or category icon
  node.filter(d => d.placeholder === "dots")
    .append("text")
    .attr("class", "node-placeholder-dots")
    .text("...")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("fill", "#fff")
    .attr("font-weight", "700")
    .attr("font-size", d => d.size * 0.62)
    .attr("letter-spacing", "0.05em");

  // Render logo inside circle for nodes that have an image
  node.filter(d => d.image)
    .append("image")
    .attr("href", d => d.image)
    .attr("x", d => -d.size)
    .attr("y", d => -d.size)
    .attr("width",  d => d.size * 2)
    .attr("height", d => d.size * 2)
    .attr("clip-path", d => `url(#clip-${d.id})`)
    .attr("preserveAspectRatio", d => d.logoFit === "contain" ? "xMidYMid meet" : "xMidYMid slice");

  node.append("text").attr("class", "node-label")
    .text(d => d.type === "asset" ? truncateLabel(d.name, 24) : d.name)
    .attr("dy", d => d.size + 18).attr("text-anchor", "middle").attr("fill", "#fff")
    .attr("font-size", d => d.type === "hub" ? "14px" : "11px").style("text-shadow", "1px 1px 2px rgba(0,0,0,0.8)");

  // Native tooltip so a truncated asset name is still readable on hover
  node.filter(d => d.type === "asset").append("title").text(d => d.name);

  // 4. INTERACTION
  node.on("mouseover", function() { d3.select(this).select("circle").attr("stroke-width", 4).attr("filter", GLOW_FILTER + " brightness(1.3)"); })
      .on("mouseout", function() { d3.select(this).select("circle").attr("stroke-width", 2).attr("filter", GLOW_FILTER); })
      .on("click", (_e, d) => { if (d.type === "asset") openAssetModal(d.id); })
      .style("cursor", d => d.type === "asset" ? "pointer" : "default");

  function renderTick() {
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
    if (particle) {
      const now = Date.now();
      particle
        .attr("cx", d => { const t = ((now + d.__phase) % PARTICLE_PERIOD) / PARTICLE_PERIOD; return d.__flowFrom.x + (d.__flowTo.x - d.__flowFrom.x) * t; })
        .attr("cy", d => { const t = ((now + d.__phase) % PARTICLE_PERIOD) / PARTICLE_PERIOD; return d.__flowFrom.y + (d.__flowTo.y - d.__flowFrom.y) * t; })
        // sin envelope: fades in leaving the outer node, peaks mid-link, fades out arriving
        .attr("opacity", d => Math.sin((((now + d.__phase) % PARTICLE_PERIOD) / PARTICLE_PERIOD) * Math.PI) * 0.85);
    }
  }

  // Paint the warm-started layout immediately, then frame it — rather than
  // starting at 1:1 wherever the force layout happened to center — so the
  // full graph is visible on load instead of just its middle.
  renderTick();
  fitVizView(0);

  // On-load reveal: fade everything in with a stagger that radiates outward
  // from the hub (hub, then categories, then leaf assets), instead of the
  // whole graph just appearing at once. Skipped under reduced-motion.
  if (!prefersReducedMotion) {
    node.style("opacity", 0).transition().delay(d => depthOf(d) * 220 + Math.random() * 150).duration(500).style("opacity", 1);
    link.style("opacity", 0).transition().delay(d => Math.max(depthOf(d.source), depthOf(d.target)) * 220 + Math.random() * 150 - 80).duration(400).style("opacity", 1);
  }

  simulation.alphaTarget(IDLE_ALPHA_TARGET).restart();
  simulation.on("tick", renderTick);

  function dragstarted(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  function dragended(event, d) { if (!event.active) simulation.alphaTarget(IDLE_ALPHA_TARGET); d.fx = null; d.fy = null; }
})();
