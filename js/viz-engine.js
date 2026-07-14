/* ===== D3.JS NEURAL NETWORK ENGINE ===== */

// Module-level globals — assigned during async init so main.js closures
// capture the variable reference (not the value) and read correctly on use.
let originalSizes = {};
let simulation, svg, zoom, g;
let nodeSelection, linkSelection;
let workforceData; // hoisted so main.js can re-fit the view (e.g. on Reset)

// Snapshot of every node's settled x/y right after the initial warm-start,
// and the function to restore it — both assigned once init finishes, so
// main.js's Reset View can put the map back exactly how it looked on load
// instead of just re-fitting whatever the layout has drifted/been dragged to.
let initialLayout = null;
let resetVizLayout = () => {};

// Branch-out state — set when a node with "Related Programs" links is
// clicked; main.js's panel-close handler calls collapseBranch() to tear it
// down. Assigned once init finishes, same pattern as resetVizLayout above.
let collapseBranch = () => {};

// Fixed hue per category — drawn from the site footer's Choose Macon brand
// palette (the gradient stripe's red/gold/blue/cream) so the map and footer
// read as one system, with a darker tonal variant of red and blue added to
// cover all six categories. These are muted brand colors, not high-contrast
// data-viz ones — every node keeps a persistent label so identity never
// depends on hue alone.
const CATEGORY_COLORS = {
  "colleges":            "#4d748c", // steel blue
  "faith-based":         "#e7decf", // cream
  "special-population":  "#afa66d", // gold
  "job-training":        "#de5e6d", // coral red
  "community-dev":       "#31556b", // deep blue
  "k12-secondary":       "#c82236"  // deep red
};

// The footer's primary gold accent — used for the hub node/links so the
// map's focal point ties back to the footer's "Contact Us" / nav gold.
const HUB_ACCENT = "#afa66d";

// Applied as an attribute (not a CSS rule) so it composes with the hover
// handler's inline "filter" attribute below instead of being silently
// out-prioritized by it — presentation attributes and inline JS .attr()
// calls share the same low cascade tier, but a stylesheet rule would win
// over both and break the hover brighten.
const GLOW_FILTER = "drop-shadow(0 0 1px currentColor) drop-shadow(0 0 4px currentColor)";

// Simulation settles to a complete stop once alpha decays to 0 (the
// default) — no perpetual idle drift.

// Asset names run long ("Macon-Bibb County Office of Workforce Development") —
// truncate the always-on label so the map stays scannable; the full name is
// still one hover (native title tooltip) or click (info panel) away.
function truncateLabel(name, maxLen) {
  return name.length > maxLen ? name.slice(0, maxLen - 1).trimEnd() + '…' : name;
}

// Computes the zoom transform that frames every current node within a
// width x height viewport, so the default/reset view shows the whole graph
// instead of whatever the force layout happened to center on.
function computeFitTransform(width, height, padding = 45) {
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
  // Capped above 1 (not just at 1) so a layout that packs smaller than the
  // container zooms in to fill the window, instead of floating in empty space.
  const scale = Math.min((width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight, 1.35);
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
  { id: "hub",                name: "Macon Workforce Navigator",          type: "hub",         size: 30, image: "" },
  { id: "colleges",           name: "Colleges",                           type: "major-group", size: 23, image: "", icon: "graduation-cap" },
  { id: "faith-based",        name: "Faith Based",                        type: "major-group", size: 23, image: "", icon: "heart" },
  { id: "special-population", name: "Special Population and Re Entry",    type: "major-group", size: 23, image: "", icon: "users" },
  { id: "job-training",       name: "Job Training and Career Services",   type: "major-group", size: 23, image: "", icon: "briefcase" },
  { id: "community-dev",      name: "Community and Economic Development", type: "major-group", size: 23, image: "", icon: "building" },
  { id: "k12-secondary",      name: "K-12 and Secondary",                 type: "major-group", size: 23, image: "", icon: "book-open" }
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
    size: data.size || 22,
    image: data.image || "",
    logoFit: data.logoFit || "cover",
    logoBg: data.logoBg || "",
    placeholder: data.placeholder || "",
    tags: data.tags || [],
    links: data.links || []
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
  const containerRect = container.node().getBoundingClientRect();
  const width = containerRect.width;
  // Read the actual rendered height instead of hardcoding it — the mobile
  // media query shrinks the container to 391px, and a mismatched viewBox
  // (sized for the desktop 612px) makes the SVG's default "meet" scaling
  // letterbox everything toward the top instead of filling the box.
  const height = containerRect.height;

  svg = container.append("svg")
    .attr("width", "100%")
    .attr("height", "100%")
    .attr("viewBox", `0 0 ${width} ${height}`);

  // Tracked so flow-particle radius can be counter-scaled against it below —
  // on a narrow/mobile container the fit-to-view zoom can land well under
  // 1:1, and a fixed SVG-unit radius shrinks to sub-pixel and disappears.
  let currentZoomScale = 1;

  zoom = d3.zoom()
    .scaleExtent([0.3, 3])
    .filter(event => event.type !== 'wheel' && !event.ctrlKey && !event.button)
    .on("zoom", (event) => { g.attr("transform", event.transform); currentZoomScale = event.transform.k; });
  svg.call(zoom);

  g = svg.append("g");

  const colorScale = d3.scaleOrdinal()
    .domain(["hub", "major-group", "asset"])
    .range(["#ffffff", HUB_ACCENT, "#afa66d"]);

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
    if (d.type === "hub") return HUB_ACCENT;
    if (d.type === "major-group") return CATEGORY_COLORS[d.id] || HUB_ACCENT;
    return CATEGORY_COLORS[d.category] || "#afa66d";
  }

  // WCAG relative luminance / contrast — used to pick a white or dark icon
  // stroke per category fill. The brand palette mixes light (cream, gold)
  // and dark (blues, reds) fills, so a single fixed icon color would go
  // invisible on roughly half of them (e.g. white-on-cream is ~1.3:1).
  function relativeLuminance(hex) {
    const c = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map(i => parseInt(c.substr(i, 2), 16) / 255)
      .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function contrastRatio(hexA, hexB) {
    const a = relativeLuminance(hexA), b = relativeLuminance(hexB);
    const lighter = Math.max(a, b), darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
  }
  function iconColor(d) {
    const fill = CATEGORY_COLORS[d.id] || HUB_ACCENT;
    return contrastRatio("#ffffff", fill) >= contrastRatio("#252525", fill) ? "#ffffff" : "#252525";
  }

  // Hops from the hub — hub itself, its six categories, then leaf assets.
  // Drives both the on-load reveal stagger and which way particles flow.
  function depthOf(d) { return d.type === "hub" ? 0 : d.type === "major-group" ? 1 : 2; }

  const prefersReducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 3. SIMULATION SETUP
  // Distances/charge pulled in a bit from the old defaults (35/130, -550) so
  // the now-larger nodes pack tighter instead of spreading out proportionally
  // — fit-to-view below scales to the container either way, so a tighter
  // layout is what actually makes nodes render bigger on screen. Collide
  // padding bumped up to match, or labels on the now-bigger nodes collide.
  // Named (not just inlined below) so Reset View can re-apply these exact
  // values later — the hub-distance/size sliders drive a *different*
  // formula, and applying that on reset would pull the restored snapshot
  // positions out of equilibrium and let them drift right back off-layout.
  const HUB_LINK_DISTANCE = 32, ASSET_LINK_DISTANCE = 112, CHARGE_STRENGTH = -500;
  simulation = d3.forceSimulation(workforceData.nodes)
    .force("link", d3.forceLink(workforceData.links).id(d => d.id).distance(d => {
        return (d.source.type === "hub" || d.target.type === "hub") ? HUB_LINK_DISTANCE : ASSET_LINK_DISTANCE;
    }))
    .force("charge", d3.forceManyBody().strength(CHARGE_STRENGTH))
    .force("center", d3.forceCenter(width / 2, height / 2))
    // Keeps nodes (and the labels hanging below them) from overlapping —
    // padding is generous since it has to clear the label text, not just the
    // circle. Major-group labels are full phrases ("Community and Economic
    // Development") and never truncated, unlike asset names, so they need
    // much more clearance or they collide with the neighbor sitting below them.
    .force("collide", d3.forceCollide(d => d.size + (d.type === "major-group" ? 95 : 40)).strength(0.9));

  // Warm-start: run the layout to near-equilibrium synchronously before the
  // first paint, so the initial fit-to-view (below) frames settled positions
  // instead of the starting jumble.
  simulation.stop();
  for (let i = 0; i < 300; i++) simulation.tick();

  // A link's color follows whichever end is the category node — asset links
  // read as belonging to their category's color, hub links stay gold.
  function linkColor(d) {
    if (d.source.type === "hub" || d.target.type === "hub") return HUB_ACCENT;
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
    // Classed so main.js's broad "g circle" node-size selector (which reads
    // originalSizes by node id) skips these — they're bound to link data, not
    // node data, and would otherwise resolve to NaN and break the size slider.
    particle = g.append("g").selectAll("circle").data(workforceData.links).join("circle")
      .attr("class", "flow-particle")
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

  node.append("circle").attr("r", d => d.size).attr("fill", fillColor).attr("stroke", "#e7decf")
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
        .attr("stroke", iconColor(d))
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .selectAll("path")
        .data(ICON_PATHS[d.icon])
        .join("path")
        .attr("d", p => p);
    });

  // Hub node gets an "MWN" wordmark instead of a photo logo or category icon.
  // Footer's dark background color, not the gold accent — gold-on-white
  // circle only clears ~2.5:1 contrast, well under WCAG's 3:1 floor even
  // for bold/large text.
  node.filter(d => d.type === "hub")
    .append("text")
    .attr("class", "node-hub-mark")
    .text("MWN")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("fill", "#252525")
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

  // "Branch-out": clicking a node with Related Programs links spawns a
  // small satellite node per link, radiating out from the parent, and
  // zooms the camera in to frame the cluster. Each satellite shows its
  // program's description on hover and opens its link on click. Clicking
  // ANY asset node zooms in on it, whether or not it has links.
  let branchGroup = null, branchSatSel = null, branchLineSel = null;
  let focusedNode = null; // whichever asset node the camera is currently zoomed in on
  const BRANCH_RADIUS = 85, BRANCH_NODE_R = 11;

  function updateBranchPositions() {
    if (!branchGroup || !focusedNode) return;
    const px = focusedNode.x, py = focusedNode.y;
    branchSatSel.attr("transform", l => `translate(${px + BRANCH_RADIUS * Math.cos(l.__angle)},${py + BRANCH_RADIUS * Math.sin(l.__angle)})`);
    branchLineSel
      .attr("x1", px).attr("y1", py)
      .attr("x2", l => px + BRANCH_RADIUS * Math.cos(l.__angle))
      .attr("y2", l => py + BRANCH_RADIUS * Math.sin(l.__angle));
  }

  function removeBranchGroup() {
    if (branchGroup) { branchGroup.remove(); branchGroup = null; branchSatSel = null; branchLineSel = null; }
  }

  // Spotlight effect: fade every other node/link/particle so the focused
  // node (and any satellites, which live in their own branchGroup and are
  // untouched by this) reads clearly instead of competing visually with
  // whatever it happens to sit near or overlap on screen.
  let focusDimActive = false;
  function setFocusDim(active) {
    focusDimActive = active;
    node.transition().duration(400).style("opacity", d => active ? (d === focusedNode ? 1 : 0.15) : 1);
    link.transition().duration(400).style("opacity", active ? 0.08 : 1);
  }

  function focusOnCluster(cx, cy, extent, duration) {
    const r = document.getElementById('network-visualization').getBoundingClientRect();
    const pad = 70;
    const scale = Math.max(0.5, Math.min((r.width - pad * 2) / (extent * 2), (r.height - pad * 2) / (extent * 2), 2.5));
    const transform = d3.zoomIdentity.translate(r.width / 2 - scale * cx, r.height / 2 - scale * cy).scale(scale);
    if (duration > 0) svg.transition().duration(duration).call(zoom.transform, transform);
    else svg.call(zoom.transform, transform);
  }

  function branchOutNode(d) {
    removeBranchGroup();
    const links = d.links;
    const color = glowColor(d);

    // Fan the satellites out AWAY from the hub, through the parent, instead
    // of surrounding it on all sides — they read as "extending outward"
    // rather than crowding whatever's already next to the parent toward
    // the hub's side.
    const hub = workforceData.nodes.find(n => n.id === "hub");
    const baseAngle = hub ? Math.atan2(d.y - hub.y, d.x - hub.x) : -Math.PI / 2;
    const spreadDeg = links.length <= 1 ? 0 : Math.min(150, 40 + (links.length - 1) * 25);
    const spreadRad = spreadDeg * Math.PI / 180;
    links.forEach((l, i) => {
      const t = links.length === 1 ? 0 : (i / (links.length - 1)) - 0.5;
      l.__angle = baseAngle + t * spreadRad;
    });

    branchGroup = g.append("g").attr("class", "node-branch");
    // pointer-events:none — these converge exactly on the parent node's
    // center and render on top of it (appended after), so without this
    // they'd steal the click meant for re-clicking the node to collapse.
    branchLineSel = branchGroup.append("g").selectAll("line").data(links).join("line")
      .attr("stroke", color).attr("stroke-width", 1.5).attr("stroke-opacity", 0.55)
      .style("pointer-events", "none");

    branchSatSel = branchGroup.append("g").selectAll("g").data(links).join("g")
      .attr("class", "branch-satellite")
      .style("cursor", "pointer")
      .on("click", (_e, l) => window.open(l.url, "_blank"));
    branchSatSel.append("circle")
      .attr("r", BRANCH_NODE_R).attr("fill", color).attr("fill-opacity", 0.3)
      .attr("stroke", color).attr("stroke-width", 1.5);
    branchSatSel.append("text")
      .text(l => truncateLabel(l.label, 20))
      .attr("text-anchor", "middle").attr("dy", BRANCH_NODE_R + 13)
      .attr("fill", "#fff").attr("font-size", "9px")
      .style("text-shadow", "1px 1px 2px rgba(0,0,0,0.8)");
    branchSatSel.append("title").text(l => l.description || l.label);

    updateBranchPositions();
    focusOnCluster(d.x, d.y, BRANCH_RADIUS + BRANCH_NODE_R + 40, 700);
  }

  collapseBranch = function (duration = 600) {
    if (!focusedNode) return;
    removeBranchGroup();
    focusedNode = null;
    setFocusDim(false);
    fitVizView(duration);
  };

  node.on("mouseover", function() { d3.select(this).select("circle").attr("stroke-width", 4).attr("filter", GLOW_FILTER + " brightness(1.3)"); })
      .on("mouseout", function() { d3.select(this).select("circle").attr("stroke-width", 2).attr("filter", GLOW_FILTER); })
      .on("click", (_e, d) => {
        if (d.type !== "asset") return;
        openAssetModal(d.id);
        if (focusedNode === d) { collapseBranch(); return; }
        removeBranchGroup();
        focusedNode = d;
        setFocusDim(true);
        if (d.links && d.links.length) branchOutNode(d);
        else focusOnCluster(d.x, d.y, d.size + 80, 700);
      })
      .style("cursor", d => d.type === "asset" ? "pointer" : "default");

  // Structural positions only — driven by the simulation's own "tick" event,
  // which (with no idle drift) only fires during an active drag/slider
  // change/reset, not perpetually.
  function renderTick() {
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => `translate(${d.x},${d.y})`);
    if (branchGroup) updateBranchPositions();
  }

  // The flowing particles are a time-based animation, not a position-based
  // one — they need to keep animating even while the simulation itself has
  // settled and stopped ticking, so they run on their own perpetual d3.timer
  // instead of piggybacking on renderTick.
  function updateParticles() {
    if (!particle) return;
    const now = Date.now();
    // Counter-scaled against the current zoom so the dot stays a constant
    // on-screen size — at a heavily zoomed-out fit (e.g. a narrow mobile
    // container) a fixed SVG-unit radius shrinks to sub-pixel and vanishes.
    const particleR = Math.max(1.5, Math.min(6, 2.5 / currentZoomScale));
    particle
      .attr("r", particleR)
      .attr("cx", d => { const t = ((now + d.__phase) % PARTICLE_PERIOD) / PARTICLE_PERIOD; return d.__flowFrom.x + (d.__flowTo.x - d.__flowFrom.x) * t; })
      .attr("cy", d => { const t = ((now + d.__phase) % PARTICLE_PERIOD) / PARTICLE_PERIOD; return d.__flowFrom.y + (d.__flowTo.y - d.__flowFrom.y) * t; })
      // sin envelope: fades in leaving the outer node, peaks mid-link, fades out arriving
      .attr("opacity", d => Math.sin((((now + d.__phase) % PARTICLE_PERIOD) / PARTICLE_PERIOD) * Math.PI) * 0.85 * (focusDimActive ? 0.1 : 1));
  }

  // Paint the warm-started layout immediately, then frame it — rather than
  // starting at 1:1 wherever the force layout happened to center — so the
  // full graph is visible on load instead of just its middle.
  renderTick();
  fitVizView(0);

  // Snapshot this settled layout so Reset View can put every node back
  // exactly here later, instead of just re-fitting the camera to wherever
  // idle drift or dragging has since carried the (still-live) simulation.
  initialLayout = {};
  workforceData.nodes.forEach(d => { initialLayout[d.id] = { x: d.x, y: d.y }; });
  resetVizLayout = function (duration = 750) {
    // Re-apply the exact forces the snapshot was settled under — the
    // hub-distance/size sliders' own formula gives different values, and
    // restoring positions without also restoring these would leave the
    // snapshot out of equilibrium, so it'd immediately start drifting again.
    simulation.force("link").distance(d => (d.source.type === "hub" || d.target.type === "hub") ? HUB_LINK_DISTANCE : ASSET_LINK_DISTANCE);
    simulation.force("charge", d3.forceManyBody().strength(CHARGE_STRENGTH));
    // d3-force scales every force by the current alpha each tick — the size/
    // hub-distance sliders just called alpha(0.4) to visibly "reheat" the
    // sim for their own change, and applying our restored forces at that
    // same high energy would perturb the snapshot right back out of place.
    simulation.alpha(0);
    workforceData.nodes.forEach(d => {
      const p = initialLayout[d.id];
      if (p) { d.x = p.x; d.y = p.y; }
      // Zero out velocity too, not just position — otherwise leftover
      // momentum from a recent drag or a slider-triggered alpha restart
      // carries the node away from the restored spot on the next tick.
      d.vx = 0;
      d.vy = 0;
      d.fx = null;
      d.fy = null;
    });
    renderTick();
    fitVizView(duration);
  };

  // Node Size defaults to 1.5, not 1.0 — reuses the same slider machinery
  // a manual drag would, so it stays in sync with the slider's displayed
  // value and with what Reset View restores.
  applySizeScale(1.5);

  // On-load reveal: fade everything in with a stagger that radiates outward
  // from the hub (hub, then categories, then leaf assets), instead of the
  // whole graph just appearing at once. Skipped under reduced-motion.
  if (!prefersReducedMotion) {
    node.style("opacity", 0).transition().delay(d => depthOf(d) * 220 + Math.random() * 150).duration(500).style("opacity", 1);
    link.style("opacity", 0).transition().delay(d => Math.max(depthOf(d.source), depthOf(d.target)) * 220 + Math.random() * 150 - 80).duration(400).style("opacity", 1);
  }

  // No idle-drift restart here — the simulation stays settled at rest until
  // a drag/slider/reset explicitly reheats it. The tick handler stays
  // registered so it fires correctly whenever that next happens.
  simulation.on("tick", renderTick);
  if (particle) d3.timer(updateParticles);

  function dragstarted(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  function dragended(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }
})();
