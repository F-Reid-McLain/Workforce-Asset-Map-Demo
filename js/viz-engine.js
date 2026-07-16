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

// Mobile category-collapse state — on narrow screens the map starts showing
// only the hub + 6 category nodes, with every org pinned invisibly on top of
// its own category, so the initial layout is compact instead of spreading
// out for orgs nobody can see yet. Tapping a category releases (and a
// second tap re-pins) just that category's orgs. Read by computeFitTransform
// below (module scope, like workforceData) so the camera only frames what's
// actually visible; the toggle function is reassigned once init finishes,
// same pattern as resetVizLayout/collapseBranch above.
let collapseCategoriesOnMobile = false;
let expandedCategoryId = null;
let setCategoriesCollapsed = () => {};

// Exposed so search.js's jumpToNode can reveal an org before the camera
// jumps to it — otherwise, while mobile categories are collapsed, searching
// for an org and jumping to it would zoom in on its still-collapsed,
// invisible parent category (the org itself has no on-screen position of
// its own until its category is expanded) instead of the org.
let revealAssetInMobileView = () => {};

// Exposed so directory.js's info-panel close button can fully reset the
// mobile map (not just tear down a branched-out asset) when the user
// leaves the panel — see the assignment further down for what this does.
let dismissMobileFocus = () => {};

function isNodeVisible(d) {
  if (d.type !== "asset") return true;
  if (!collapseCategoriesOnMobile) return true;
  return d.category === expandedCategoryId;
}

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
  workforceData.nodes.filter(isNodeVisible).forEach(d => {
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

// Combines two independent reasons the zoom behavior might reject an
// event: wheel scrolling is only meant to zoom the map in fullscreen (else
// it'd hijack normal page scroll), and — separately — all pan/zoom/pinch
// is suspended entirely while the mobile info panel is open (see
// setMapInteractionFrozen below). Recomputed whenever either changes.
let wheelZoomEnabled = false;
let mapInteractionFrozen = false;
function applyZoomFilter() {
  if (!zoom) return;
  zoom.filter(event => {
    if (mapInteractionFrozen) return false;
    if (event.type === 'wheel' && !wheelZoomEnabled) return false;
    return !event.ctrlKey && !event.button;
  });
}

// Called by main.js when fullscreen state changes
function setWheelZoomEnabled(enabled) {
  wheelZoomEnabled = enabled;
  applyZoomFilter();
}

// Wired below (once the info panel element exists) to a MutationObserver on
// its "open" class, so every way the panel can open or close — clicking a
// node, the search results list, the X button, Reset View — freezes/thaws
// the map the same way without needing its own call site.
function setMapInteractionFrozen(frozen) {
  mapInteractionFrozen = frozen;
  applyZoomFilter();
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

  // The *1.5 bakes in what used to be the slider's default multiplier, so
  // that main.js's new default of currentSizeScale = 1 renders every node
  // at exactly the same size as before — only the slider's own numbering
  // changed (old 1.5 default -> new 1 default), not any actual node size.
  workforceData.nodes.forEach(node => { originalSizes[node.id] = node.size * 1.5; });

  // Narrow screens start with categories collapsed — see the module-level
  // comment above collapseCategoriesOnMobile for why.
  const MOBILE_BREAKPOINT = 768;
  collapseCategoriesOnMobile = window.innerWidth <= MOBILE_BREAKPOINT;

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
    if (d.type === "hub") return "#3a3a3a"; // monochrome grey badge, matches the favicon
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

  // Mobile: pin the 6 categories into a clean, deterministic ring around the
  // hub instead of wherever the full 30-asset organic graph happens to
  // settle them — the desktop layout has no reason to look clean once
  // everything but the hub+categories is hidden (categories can end up
  // bunched to one side, overlapping, off-center). Pinned (fx/fy), not just
  // seeded, so it can't drift asymmetric and stays put through category
  // expand/collapse — only "Show Full Map" releases them back to the
  // normal organic layout.
  function layoutCategoriesRadially() {
    const hub = workforceData.nodes.find(n => n.id === "hub");
    // Pin the hub itself too — otherwise it drifts toward forceCenter's
    // target over the warm-start's hundreds of ticks while the categories,
    // anchored to wherever the hub started (before any ticking), stay put:
    // the two end up thousands of units apart instead of together.
    hub.x = width / 2; hub.y = height / 2;
    hub.fx = hub.x; hub.fy = hub.y;
    hub.vx = 0; hub.vy = 0;
    const categories = workforceData.nodes.filter(n => n.type === "major-group");
    const radius = 150;
    categories.forEach((cat, i) => {
      const angle = (i / categories.length) * 2 * Math.PI - Math.PI / 2; // first one straight up
      cat.x = hub.x + radius * Math.cos(angle);
      cat.y = hub.y + radius * Math.sin(angle);
      cat.fx = cat.x; cat.fy = cat.y;
      cat.vx = 0; cat.vy = 0;
    });
  }

  if (collapseCategoriesOnMobile) layoutCategoriesRadially();

  // Warm-start: run the layout to near-equilibrium synchronously before the
  // first paint, so the initial fit-to-view (below) frames settled positions
  // instead of the starting jumble. On mobile the categories are pinned per
  // above, so this settles each category's (still-unpinned, still-hidden at
  // this point) orgs naturally around that clean ring.
  simulation.stop();
  for (let i = 0; i < 300; i++) simulation.tick();

  // Pins every org exactly on top of its category — invisible (opacity is
  // applied further down) and out of the way, so the collapsed mobile view
  // stays a compact hub+categories layout instead of one that's still
  // spread out to make room for orgs nobody can see yet.
  function pinAllAssetsToCategories() {
    workforceData.nodes.forEach(n => {
      if (n.type !== "asset") return;
      const cat = workforceData.nodes.find(c => c.id === n.category);
      if (!cat) return;
      // Tiny per-node offset so pinned siblings aren't perfectly coincident —
      // a zero-distance start makes the charge force's direction undefined
      // for an instant when they're later released together.
      const jitter = (n.id.charCodeAt(0) % 7) - 3;
      n.x = cat.x + jitter; n.y = cat.y + jitter;
      n.fx = n.x; n.fy = n.y;
      n.vx = 0; n.vy = 0;
    });
  }

  if (collapseCategoriesOnMobile) {
    pinAllAssetsToCategories();
    for (let i = 0; i < 120; i++) simulation.tick();
  }

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

  node.append("circle").attr("r", d => d.size).attr("fill", fillColor)
    .attr("stroke", d => d.type === "hub" ? "#888888" : "#e7decf")
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

  // Hub node gets the site's own mark — Bibb County's outline with "MWN"
  // set inside it — instead of a photo logo or category icon. Drawn at its
  // native 400x400 coordinates and scaled/recentered into the hub circle's
  // local origin; the shape's own farthest vertex is 183.5 units from its
  // center, so scale 0.147 brings that in to ~27, just inside the hub's
  // r=30 circle. Light grey on the hub's dark grey fill — same monochrome
  // badge as the site favicon, no gold or white.
  const HUB_MARK_PATH = "M20,184.085L164.724,52.47L164.724,52.47L182.458,89.371L221.394,115.101L272.289,108.439L354.688,144.271L354.688,144.271L380,164.265L312.483,266.527L289.693,265.786L290.657,322.595L306.905,347.53L306.905,347.53L244.857,344.452L210.451,329.338L210.451,329.338L178.32,331.647L109.56,301.349L23.999,215.301Z";
  const hubMark = node.filter(d => d.type === "hub")
    .append("g")
    .attr("class", "node-hub-mark")
    .attr("transform", d => `scale(${(d.size * 0.9) / 183.5}) translate(-200,-200)`);
  hubMark.append("path")
    .attr("d", HUB_MARK_PATH)
    .attr("fill", "none")
    .attr("stroke", "#cccccc")
    .attr("stroke-width", 7)
    .attr("stroke-linejoin", "round")
    .attr("stroke-linecap", "round");
  hubMark.append("text")
    .text("MWN")
    .attr("text-anchor", "middle")
    .attr("x", 196).attr("y", 222)
    .attr("fill", "#cccccc")
    .attr("font-weight", "700")
    .attr("font-size", 88)
    .attr("letter-spacing", 2);

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
    // __radius is set per-link in branchOutNode, shrunk from BRANCH_RADIUS
    // when the safe viewport is too tight to hold the full-size fan at a
    // readable zoom — falls back to the default whenever that sizing hasn't
    // run (shouldn't normally happen, but keeps this safe as a stand-alone
    // function).
    const r = l => l.__radius != null ? l.__radius : BRANCH_RADIUS;
    branchSatSel.attr("transform", l => `translate(${px + r(l) * Math.cos(l.__angle)},${py + r(l) * Math.sin(l.__angle)})`);
    branchLineSel
      .attr("x1", px).attr("y1", py)
      .attr("x2", l => px + r(l) * Math.cos(l.__angle))
      .attr("y2", l => py + r(l) * Math.sin(l.__angle));
  }

  function removeBranchGroup() {
    if (branchGroup) { branchGroup.remove(); branchGroup = null; branchSatSel = null; branchLineSel = null; }
  }

  // Mobile category-collapse — applies the current isNodeVisible() state to
  // the already-created node/link/particle selections (nothing is ever
  // added or removed from the DOM; hidden orgs just sit pinned and invisible
  // on their category, per pinAllAssetsToCategories above). While a category
  // is expanded, the rest of the map (every other category, the hub, and
  // any link not touching the expanded category) fades down to near-
  // invisible instead of just dimming — the camera is zooming in tight on
  // just the expanded one, so the background should read as gone, not as a
  // competing element. Left faintly visible rather than opacity 0 so a
  // category can still be tapped directly to switch to it without needing
  // to back out first. The expanded one's own children get their names
  // shown too, shortened and alternating near/far (see expandCategory's
  // __labelStagger) so adjacent labels in a tight ring don't run into each
  // other the way two full-length names sitting at the same distance
  // would.
  const MOBILE_FADE_OPACITY = 0.08;
  function updateMobileVisibility(withTransition) {
    const nodeOpacity = d => {
      if (expandedCategoryId) {
        if (d.type === "major-group") return d.id === expandedCategoryId ? 1 : MOBILE_FADE_OPACITY;
        if (d.type === "hub") return MOBILE_FADE_OPACITY;
      }
      return isNodeVisible(d) ? 1 : 0;
    };
    const linkOpacity = d => {
      if (!(isNodeVisible(d.source) && isNodeVisible(d.target))) return 0;
      if (expandedCategoryId) {
        const touchesExpanded = d.source.id === expandedCategoryId || d.target.id === expandedCategoryId;
        return touchesExpanded ? 1 : MOBILE_FADE_OPACITY;
      }
      return 1;
    };
    (withTransition ? node.transition().duration(500) : node)
      .style("opacity", nodeOpacity);
    node.style("pointer-events", d => isNodeVisible(d) ? null : "none");
    (withTransition ? link.transition().duration(500) : link)
      .style("opacity", linkOpacity);
    if (particle) particle.style("display", d => (isNodeVisible(d.source) && isNodeVisible(d.target)) ? null : "none");
    node.filter(d => d.type === "major-group")
      .style("cursor", collapseCategoriesOnMobile ? "pointer" : "default");
    const isExpandedChild = d => d.type === "asset" && d.category === expandedCategoryId;
    node.select(".node-label")
      .style("opacity", null)
      .text(d => isExpandedChild(d) ? truncateLabel(d.name, 16) : (d.type === "asset" ? truncateLabel(d.name, 24) : d.name))
      .attr("dy", d => isExpandedChild(d) ? d.size + 18 + (d.__labelStagger ? 15 : 0) : d.size + 18);
  }

  // Snaps a category's orgs back onto it (using its CURRENT position, which
  // may have moved since they were last pinned — e.g. a hub-distance/size
  // slider change) and re-fixes them there.
  function collapseCategory(catId) {
    const cat = workforceData.nodes.find(n => n.id === catId);
    if (!cat) return;
    workforceData.nodes.forEach(n => {
      if (n.type === "asset" && n.category === catId) { n.fx = cat.x; n.fy = cat.y; }
    });
  }

  // Explicitly rings children out around the category and PINS them there —
  // same "pinned, not live-simulated" convention as branchOutNode's
  // satellites, for the same reason: releasing them into the force
  // simulation (even from a good seeded position) was tried first and
  // didn't hold up. With the whole rest of the graph pinned (categories in
  // the ring, every other category's hidden children), the charge force has
  // nothing to balance against near this one release point and keeps
  // pushing outward for as long as alpha takes to decay — nodes ended up
  // 200-500+ units from their category instead of the ~100 seeded. A full
  // pin is the only way this stays exactly where it's put.
  //
  // A full 360° ring, not a fan opening away from the hub — with the rest
  // of the map fading out on expand (see updateMobileVisibility), there's
  // no longer a reason to leave a gap on the hub-facing side, and a full
  // ring gives many-child categories (Job Training's 11) far more breathing
  // room per child than a ~170° arc ever could. Returns the ring radius, so
  // the caller can zoom in to fit it exactly.
  function expandCategory(catNode) {
    const children = workforceData.nodes.filter(n => n.type === "asset" && n.category === catNode.id);
    if (!children.length) return 60;
    const hub = workforceData.nodes.find(n => n.id === "hub");
    // Child 0 still starts pointing away from the hub, purely so the ring
    // has a consistent, predictable starting orientation — the ring itself
    // goes all the way around from there.
    const baseAngle = hub ? Math.atan2(catNode.y - hub.y, catNode.x - hub.x) : -Math.PI / 2;
    // Radius has to grow with node size, not just child count: at a fixed
    // angular step, more children means a tighter step between neighbors,
    // so the chord distance between their centers shrinks. Once that chord
    // drops below the sum of their radii, circles overlap (seen with Job
    // Training's 11 children on the old fan — several logos were fully
    // hidden behind neighbors). Solve for the radius that keeps every
    // adjacent pair's chord >= their combined size + a gap.
    const scale = typeof currentSizeScale === "number" ? currentSizeScale : 1;
    const childRadius = Math.max(...children.map(n => (originalSizes[n.id] || 33) * scale));
    let radius = 60 + Math.min(children.length, 12) * 6;
    if (children.length > 1) {
      const step = (2 * Math.PI) / children.length;
      const minChord = 2 * childRadius + childRadius * 0.35;
      radius = Math.max(radius, minChord / (2 * Math.sin(step / 2)));
    }
    children.forEach((n, i) => {
      const angle = baseAngle + (i / children.length) * 2 * Math.PI;
      n.x = catNode.x + radius * Math.cos(angle);
      n.y = catNode.y + radius * Math.sin(angle);
      n.fx = n.x; n.fy = n.y;
      n.vx = 0; n.vy = 0;
      // Alternating near/far label distance (see updateMobileVisibility) —
      // adjacent labels in a tight ring would otherwise collide even though
      // the nodes themselves don't, since text is much wider than the node
      // it sits under.
      n.__labelStagger = i % 2;
    });
    renderTick();
    return radius;
  }

  // Expanding zooms in tight on just the category + its fanned-out children
  // (like focusOnCluster already does for an asset's Related Programs
  // satellites) instead of trying to keep the whole ring in frame — a
  // category with a dozen orgs needs real room, not a shrunk-to-fit view.
  // Collapsing back returns to framing the full ring.
  function toggleCategoryExpansion(catNode) {
    if (expandedCategoryId === catNode.id) {
      collapseCategory(catNode.id);
      expandedCategoryId = null;
      updateMobileVisibility(true);
      fitVizView(700);
    } else {
      if (expandedCategoryId) collapseCategory(expandedCategoryId);
      const radius = expandCategory(catNode);
      expandedCategoryId = catNode.id;
      updateMobileVisibility(true);
      focusOnCluster(catNode.x, catNode.y, radius + 50, 700);
    }
  }

  // Exposed at module scope so the "Show Full Map" toggle button (wired in
  // main.js-adjacent markup, queried below) can flip modes; also called by
  // resetVizLayout indirectly through collapseCategoriesOnMobile's read.
  setCategoriesCollapsed = function (collapsed) {
    collapseCategoriesOnMobile = collapsed;
    expandedCategoryId = null;
    if (collapsed) {
      layoutCategoriesRadially();
      pinAllAssetsToCategories();
    } else {
      workforceData.nodes.forEach(n => { n.fx = null; n.fy = null; }); // releases the hub too, pinned by layoutCategoriesRadially
    }
    simulation.alpha(0.5).restart();
    if (!collapsed) {
      // Releasing every node into live physics here (unlike a normal drag,
      // which only disturbs nodes near the one being dragged) can carry
      // real organic drift for several seconds — long enough that a node
      // ends up outside the frame this fit captures by the time it
      // actually settles, stranding it off-screen. Re-fit once more when
      // the simulation comes to rest, as a one-off listener scoped to just
      // this transition so a user's own later drags aren't auto-recentered
      // out from under them.
      simulation.on("end.showFullMapSettle", () => {
        simulation.on("end.showFullMapSettle", null);
        fitVizView(500);
      });
    }
    updateMobileVisibility(true);
    fitVizView(700);
    const toggleBtns = document.querySelectorAll(".mobile-map-toggle");
    toggleBtns.forEach(btn => { btn.textContent = collapsed ? "Show Full Map" : "Show Categories Only"; });
  };

  revealAssetInMobileView = function (assetId) {
    if (!collapseCategoriesOnMobile) return;
    const asset = workforceData.nodes.find(n => n.id === assetId);
    const cat = asset && workforceData.nodes.find(n => n.id === asset.category);
    if (!cat || expandedCategoryId === cat.id) return;
    if (expandedCategoryId) collapseCategory(expandedCategoryId);
    expandCategory(cat);
    expandedCategoryId = cat.id;
    updateMobileVisibility(true);
  };

  const mobileToggleBtns = document.querySelectorAll(".mobile-map-toggle");
  mobileToggleBtns.forEach(btn => {
    btn.textContent = collapseCategoriesOnMobile ? "Show Full Map" : "Show Categories Only";
    btn.addEventListener("click", () => setCategoriesCollapsed(!collapseCategoriesOnMobile));
  });

  // The info panel only covers part of the container (bottom 45% in
  // portrait, a left strip in landscape) — the rest of the map stays
  // visible and, without this, still fully pannable/zoomable underneath
  // it. On mobile that's exactly where a thumb rests while scrolling the
  // panel's text, so a stray touch could shift the camera out from under
  // the node the panel is describing. Freeze the map's pan/zoom/drag for
  // as long as the panel is open, on mobile only — driven by the panel's
  // own "open" class so every way it can open or close (a node tap, a
  // search result, the X button, Reset View) is covered without a
  // separate call site at each one.
  const infoPanelEl = document.getElementById('viz-info-panel');
  if (infoPanelEl) {
    const syncMapFreeze = () => {
      const isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setMapInteractionFrozen(isMobile && infoPanelEl.classList.contains('open'));
    };
    new MutationObserver(syncMapFreeze).observe(infoPanelEl, { attributes: true, attributeFilter: ['class'] });
    syncMapFreeze();
  }

  // Satellite links lead off-site, so confirm before leaving rather than
  // opening a new tab the instant a small, easy-to-misclick node is tapped.
  const linkConfirmModal    = document.getElementById('link-confirm-modal');
  const linkConfirmLabel    = document.getElementById('link-confirm-label');
  const linkConfirmOpenBtn  = document.getElementById('link-confirm-open');
  const linkConfirmCancelBtn = document.getElementById('link-confirm-cancel');
  const linkConfirmCloseBtn  = document.getElementById('link-confirm-close');
  let pendingLinkUrl = null;

  function closeLinkConfirm() {
    if (linkConfirmModal) linkConfirmModal.style.display = "none";
    pendingLinkUrl = null;
  }

  function showLinkConfirm(l) {
    if (!linkConfirmModal) { window.open(l.url, "_blank"); return; } // fallback if markup is ever missing
    pendingLinkUrl = l.url;
    linkConfirmLabel.textContent = l.label;
    linkConfirmModal.style.display = "block";
  }

  if (linkConfirmOpenBtn) linkConfirmOpenBtn.onclick = () => {
    if (pendingLinkUrl) window.open(pendingLinkUrl, "_blank");
    closeLinkConfirm();
  };
  if (linkConfirmCancelBtn) linkConfirmCancelBtn.onclick = closeLinkConfirm;
  if (linkConfirmCloseBtn) linkConfirmCloseBtn.onclick = closeLinkConfirm;
  if (linkConfirmModal) linkConfirmModal.onclick = (e) => { if (e.target === linkConfirmModal) closeLinkConfirm(); };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && linkConfirmModal && linkConfirmModal.style.display === 'block') closeLinkConfirm();
  });

  // Spotlight effect: fade every other node/link/particle so the focused
  // node (and any satellites, which live in their own branchGroup and are
  // untouched by this) reads clearly instead of competing visually with
  // whatever it happens to sit near or overlap on screen.
  let focusDimActive = false;
  function setFocusDim(active) {
    focusDimActive = active;
    // Un-focusing restores each node/link to whatever the mobile category-
    // collapse state says it should be, not unconditionally back to 1 —
    // otherwise this would flash orgs a collapsed category had hidden.
    node.transition().duration(400).style("opacity", d => active ? (d === focusedNode ? 1 : (collapseCategoriesOnMobile ? MOBILE_FADE_OPACITY : 0.15)) : (isNodeVisible(d) ? 1 : 0));
    link.transition().duration(400).style("opacity", d => active ? 0.08 : ((isNodeVisible(d.source) && isNodeVisible(d.target)) ? 1 : 0));
    // Every OTHER node's label hides while focused — a label sitting right
    // where satellites fan out was the single biggest source of unreadable
    // overlapping text — but the focused node's own name should stay
    // visible now that it's centered and filling the screen, not rely on
    // the info panel alone to say what it's looking at.
    node.select(".node-label").transition().duration(250).style("opacity", d => active ? (d === focusedNode ? 1 : 0) : 1);
  }

  // The info panel covers part of #network-visualization (left strip in
  // landscape, bottom strip in portrait) without shrinking that element, so
  // centering against its full rect puts focused clusters partly behind the
  // panel. This returns the actual unobstructed area to center within.
  function getSafeViewportRect() {
    const containerRect = document.getElementById('network-visualization').getBoundingClientRect();
    const panelEl = document.getElementById('viz-info-panel');
    let left = 0, top = 0, width = containerRect.width, height = containerRect.height;
    if (panelEl && panelEl.classList.contains('open')) {
      const panelRect = panelEl.getBoundingClientRect();
      if (window.matchMedia("(orientation: landscape)").matches) {
        left = panelRect.width;
        width = containerRect.width - panelRect.width;
      } else {
        height = containerRect.height - panelRect.height;
      }
    }
    return { left, top, width, height };
  }

  function focusOnCluster(cx, cy, extent, duration, strictFit, bounds, pad = 70) {
    const safe = getSafeViewportRect();
    // A tapped node should genuinely fill the screen on mobile, not just
    // center — the same 2.5x cap that's right for a spacious desktop
    // canvas leaves a lot of empty space around a single small node on a
    // phone. Only raised while the mobile category view is active; "Show
    // Full Map" mode and desktop keep the original cap.
    const maxScale = collapseCategoriesOnMobile ? 4.5 : 2.5;
    // `extent` alone assumes a square, (cx,cy)-centered footprint — fine for
    // a ring or a single node, but a branch-out fan is both wider than it is
    // tall (or vice versa) AND lopsided around the node itself (e.g. a fan
    // that only opens upward has no footprint below it at all). Squaring it
    // off, or centering on the node when the true content isn't centered on
    // it, both waste room that's actually free, forcing a deeper zoom-out
    // than the real content needs. Callers that know their true footprint
    // pass `bounds: {left, right, top, bottom}` (measured off the real
    // rendered geometry, relative to cx,cy) to fit and center on the actual
    // bounding box instead.
    const left = bounds ? bounds.left : -extent;
    const right = bounds ? bounds.right : extent;
    const top = bounds ? bounds.top : -extent;
    const bottom = bounds ? bounds.bottom : extent;
    const fitScale = Math.min((safe.width - pad * 2) / (right - left), (safe.height - pad * 2) / (bottom - top), maxScale);
    // Tapping a child node opens the info panel, which eats into the safe
    // area (see getSafeViewportRect) — its extent-based fit-scale can end
    // up smaller than the category ring's own zoom level the user was just
    // looking at, which reads as the camera zooming back OUT on a tap that
    // should zoom further IN. Floor the new scale a bit above whatever the
    // camera's current scale already is, so a tap only ever climbs the
    // zoom level (or holds roughly steady), never visibly retreats.
    //
    // That floor is unsafe for callers whose extent represents real,
    // literal content that has to be contained (branch-out satellites and
    // their labels) rather than a single point that just looks better
    // bigger — flooring the scale above fitScale there re-introduces
    // exactly the overflow this floor was never meant to allow. Those
    // callers pass strictFit=true to skip the climb-only floor and always
    // honor fitScale.
    const currentScale = d3.zoomTransform(svg.node()).k;
    // The 0.5 absolute floor is also a "never mind fitScale" override, same
    // as the climb-only one above — a strictFit caller needs fitScale
    // honored all the way down, even below 0.5, or a footprint that
    // genuinely needs a smaller scale gets cut off exactly the same way.
    const scale = strictFit ? Math.min(maxScale, fitScale) : Math.min(maxScale, Math.max(Math.max(0.5, currentScale * 1.15), fitScale));
    const targetX = safe.left + safe.width / 2;
    const targetY = safe.top + safe.height / 2;
    // Center the bounding box's own midpoint, not (cx,cy) itself — for a
    // symmetric extent these are the same point, but for a lopsided bounds
    // (like a fan that only opens upward) the box's midpoint sits well off
    // to one side of the node, and centering the node instead would waste
    // exactly the empty half the fan never uses.
    const boxCx = cx + (left + right) / 2;
    const boxCy = cy + (top + bottom) / 2;
    const transform = d3.zoomIdentity.translate(targetX - scale * boxCx, targetY - scale * boxCy).scale(scale);
    if (duration > 0) svg.transition().duration(duration).call(zoom.transform, transform);
    else svg.call(zoom.transform, transform);
  }

  function branchOutNode(d) {
    removeBranchGroup();
    const links = d.links;
    const color = glowColor(d);

    // openAssetModal (called by this click handler just before branchOutNode)
    // always opens the info panel first, so by this point it's reliably
    // open — meaning there's always exactly one occluded edge to avoid
    // (bottom in portrait, left in landscape). Aim the fan straight at the
    // opposite, guaranteed-open edge rather than away from the hub — the
    // hub-relative direction is arbitrary and, with a fan wide enough to
    // need real angular room, its OUTER edges could still dip into the
    // panel's side even after just mirroring the center. Capping the total
    // spread at 180° keeps the entire fan — not just its center — at or
    // above the horizon around that safe direction, guaranteed by geometry
    // rather than by hoping the hub happened to be the right way round.
    const isLandscape = window.matchMedia("(orientation: landscape)").matches;
    const baseAngle = isLandscape ? 0 : -Math.PI / 2; // rightward in landscape, upward in portrait
    const spreadDeg = links.length <= 1 ? 0 : Math.min(170, 40 + (links.length - 1) * 30);
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
      .on("click", (_e, l) => showLinkConfirm(l));
    // Classed so main.js's broad "g circle" node-size selector (which reads
    // originalSizes by node id) skips these — they're bound to link data,
    // not node data, and would otherwise resolve to NaN.
    branchSatSel.append("circle")
      .attr("class", "branch-node-circle")
      .attr("r", BRANCH_NODE_R).attr("fill", color).attr("fill-opacity", 0.3)
      .attr("stroke", color).attr("stroke-width", 1.5);
    branchSatSel.append("text")
      // Much shorter than the 20-char cap used elsewhere — a satellite fan
      // packs several of these close together (see sharedRadius below), so
      // a narrower label footprint keeps neighbors from touching without
      // needing the fan any wider (and the full name is always one tap
      // away — the info panel already lists it in full).
      .text(l => truncateLabel(l.label, 11))
      .attr("text-anchor", "middle").attr("dy", BRANCH_NODE_R + 13)
      .attr("fill", "#fff").attr("font-size", "9px")
      .style("text-shadow", "1px 1px 2px rgba(0,0,0,0.8)");
    branchSatSel.append("title").text(l => l.description || l.label);

    // The fan's size is driven by its own content, not by how much safe
    // viewport happens to be left once the info panel opens — trying to
    // shrink the radius to whatever tiny space was available (the previous
    // approach here) just traded one bad outcome (a zoomed-out, unreadable
    // camera) for another (satellites packed so close their labels overlap
    // each other, or the parent node). Solve for the radius that keeps
    // labels legibly apart (same chord-distance approach expandCategory
    // uses for its ring, sized off each label's own real rendered width via
    // getBBox()), then let focusOnCluster's own honest fit — already fixed
    // above to respect strictFit all the way down — decide however much
    // zoom that well-spaced fan actually needs. The directional bias above
    // (fanning toward the open side) and the shorter 11-char labels/wider
    // spread below keep that zoom in a reasonable range in practice.
    const bboxes = branchSatSel.nodes().map(n => n.getBBox());
    let sharedRadius = BRANCH_RADIUS;
    if (links.length > 1) {
      const step = spreadRad / (links.length - 1);
      const effectiveSize = Math.max(BRANCH_NODE_R, ...bboxes.map(b => b.width / 2));
      const minChord = 2 * effectiveSize + effectiveSize * 0.35;
      sharedRadius = Math.max(BRANCH_RADIUS, minChord / (2 * Math.sin(step / 2)));
    }
    links.forEach(l => { l.__radius = sharedRadius; });

    updateBranchPositions();
    // Measure the fan's real, true bounding box off the rendered geometry —
    // aiming the whole fan upward (or rightward) means it has essentially
    // no footprint on the opposite side of the node at all, and treating it
    // as a symmetric halfW/halfH square would center the node in the middle
    // of the safe area, wasting exactly the empty half the fan never uses.
    let left = -BRANCH_NODE_R, right = BRANCH_NODE_R, top = -BRANCH_NODE_R, bottom = BRANCH_NODE_R;
    links.forEach((l, i) => {
      const bbox = bboxes[i];
      const px = sharedRadius * Math.cos(l.__angle);
      const py = sharedRadius * Math.sin(l.__angle);
      left = Math.min(left, px + bbox.x);
      right = Math.max(right, px + bbox.x + bbox.width);
      top = Math.min(top, py + bbox.y);
      bottom = Math.max(bottom, py + bbox.y + bbox.height);
    });
    // strictFit=true so this framing is never overridden by focusOnCluster's
    // climb-only zoom floor — that floor was forcing the scale back up past
    // whatever fitScale this measured footprint actually needs, whenever a
    // category was already zoomed in tight before the satellites appeared.
    // A tighter pad than the 70px default — the fan's own bounding box
    // already includes each label's full reach, so there's no need for as
    // much extra breathing room around it as a single node or ring wants.
    focusOnCluster(d.x, d.y, BRANCH_RADIUS + BRANCH_NODE_R + 65, 700, true, { left, right, top, bottom }, 25);
  }

  collapseBranch = function (duration = 600) {
    if (!focusedNode) return;
    removeBranchGroup();
    focusedNode = null;
    setFocusDim(false);
    fitVizView(duration);
  };

  function closeInfoPanel() {
    const panel = document.getElementById('viz-info-panel');
    if (panel) panel.classList.remove('open');
  }

  // Tapping empty map background, on mobile, is a soft "dismiss" — closes
  // whatever's currently open on top of the base view (the info panel, a
  // branched-out asset, an expanded category) and recenters, without
  // changing collapsed/full-map mode. Mirrors tap-outside-to-close, a
  // pattern users already expect from the panel/modal itself. Assigned
  // (not declared with `function` alone) so this reassigns the module-
  // level variable of the same name above, rather than shadowing it with
  // a binding local to this closure that directory.js could never reach.
  dismissMobileFocus = function () {
    closeInfoPanel();
    // Both can be true at once — a focused asset sitting inside its still-
    // expanded category — so clear both instead of stopping at whichever
    // is innermost, or the category would linger open underneath.
    if (focusedNode) collapseBranch();
    if (expandedCategoryId) {
      collapseCategory(expandedCategoryId);
      expandedCategoryId = null;
      updateMobileVisibility(true);
    }
    fitVizView(700);
  }

  // Tapping the hub, on mobile, is the definitive "take me home" — same
  // dismissal as above, but always ends back on the trimmed categories-only
  // ring, switching out of "Show Full Map" if that was active, instead of
  // just recentering whatever's currently shown.
  function goHomeMobile() {
    closeInfoPanel();
    if (focusedNode) collapseBranch();
    if (!collapseCategoriesOnMobile) { setCategoriesCollapsed(true); return; } // re-fits internally
    if (expandedCategoryId) {
      collapseCategory(expandedCategoryId);
      expandedCategoryId = null;
      updateMobileVisibility(true);
    }
    fitVizView(700);
  }

  // Background click — only when the tap lands on genuinely empty canvas
  // (event.target is the svg element itself), never when it bubbles up
  // from a node, so this never fights the node click handler below.
  svg.on("click", (event) => {
    if (event.target !== svg.node()) return;
    if (window.innerWidth <= MOBILE_BREAKPOINT) dismissMobileFocus();
  });

  node.on("mouseover", function() { d3.select(this).select("circle").attr("stroke-width", 4).attr("filter", GLOW_FILTER + " brightness(1.3)"); })
      .on("mouseout", function() { d3.select(this).select("circle").attr("stroke-width", 2).attr("filter", GLOW_FILTER); })
      .on("click", (_e, d) => {
        if (d.type === "hub") {
          if (window.innerWidth <= MOBILE_BREAKPOINT) goHomeMobile();
          return;
        }
        if (d.type === "major-group") {
          if (collapseCategoriesOnMobile) toggleCategoryExpansion(d);
          return;
        }
        if (d.type !== "asset") return;
        openAssetModal(d.id);
        if (focusedNode === d) { collapseBranch(); return; }
        removeBranchGroup();
        focusedNode = d;
        setFocusDim(true);
        if (d.links && d.links.length) branchOutNode(d);
        else focusOnCluster(d.x, d.y, d.size + 80, 700);
      })
      .style("cursor", d => {
        if (d.type === "asset") return "pointer";
        if (d.type === "major-group" && collapseCategoriesOnMobile) return "pointer";
        if (d.type === "hub" && window.innerWidth <= MOBILE_BREAKPOINT) return "pointer";
        return "default";
      });

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
    // Reset always returns to the fully-collapsed default on mobile, not
    // whatever category happened to be expanded — re-pinning (including the
    // category ring) is needed even though positions already match it
    // (initialLayout was snapshotted post-pin), since the fx/fy clear just
    // above releases everything.
    expandedCategoryId = null;
    if (collapseCategoriesOnMobile) {
      layoutCategoriesRadially();
      pinAllAssetsToCategories();
    }
    updateMobileVisibility(false);
    renderTick();
    fitVizView(duration);
  };

  // Reuses the same slider machinery a manual drag would, so it stays in
  // sync with the slider's displayed value and with what Reset View
  // restores. 1 = the map's normal default size (see originalSizes above).
  applySizeScale(1);

  // On-load reveal: fade everything in with a stagger that radiates outward
  // from the hub (hub, then categories, then leaf assets), instead of the
  // whole graph just appearing at once — except orgs hidden by the mobile
  // category-collapse, which fade to 0 (i.e. stay invisible) instead of 1,
  // so they don't flash into view before immediately being hidden again.
  // Skipped under reduced-motion, but still needs the same final opacity.
  if (!prefersReducedMotion) {
    node.style("opacity", 0).transition().delay(d => depthOf(d) * 220 + Math.random() * 150).duration(500).style("opacity", d => isNodeVisible(d) ? 1 : 0);
    link.style("opacity", 0).transition().delay(d => Math.max(depthOf(d.source), depthOf(d.target)) * 220 + Math.random() * 150 - 80).duration(400).style("opacity", d => (isNodeVisible(d.source) && isNodeVisible(d.target)) ? 1 : 0);
  } else {
    node.style("opacity", d => isNodeVisible(d) ? 1 : 0);
    link.style("opacity", d => (isNodeVisible(d.source) && isNodeVisible(d.target)) ? 1 : 0);
  }
  node.style("pointer-events", d => isNodeVisible(d) ? null : "none");
  if (particle) particle.style("display", d => (isNodeVisible(d.source) && isNodeVisible(d.target)) ? null : "none");

  // No idle-drift restart here — the simulation stays settled at rest until
  // a drag/slider/reset explicitly reheats it. The tick handler stays
  // registered so it fires correctly whenever that next happens.
  simulation.on("tick", renderTick);
  if (particle) d3.timer(updateParticles);

  // Nothing is freely draggable on mobile, full stop — the layout is fixed
  // there (no more "Show Full Map" escape hatch to a freely-arranged
  // graph), so every node's position is managed entirely by the pin
  // system. Checked directly against viewport width rather than only
  // collapseCategoriesOnMobile, since that flag existed to support a
  // toggle that no longer has any UI path to flip it — this stays correct
  // even if that variable's role changes later. A touch "tap" fires a
  // zero-distance drag lifecycle same as a real drag would, and dragended
  // below unconditionally clears fx/fy on release; without this guard,
  // simply tapping a category (or one of its fanned-out children) would
  // silently un-pin that node, leaving it free to be flung outward by the
  // charge force on the next restart since everything around it stays
  // pinned with nothing to balance against.
  function isDragLocked(d) {
    return window.innerWidth <= MOBILE_BREAKPOINT || collapseCategoriesOnMobile || mapInteractionFrozen;
  }
  function dragstarted(event, d) { if (isDragLocked(d)) return; if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
  function dragged(event, d) { if (isDragLocked(d)) return; d.fx = event.x; d.fy = event.y; }
  function dragended(event, d) { if (isDragLocked(d)) return; if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }
})();
