/* ===== D3.JS NEURAL NETWORK ENGINE ===== */

// Module-level globals — assigned during async init so main.js closures
// capture the variable reference (not the value) and read correctly on use.
let originalSizes = {};
let simulation, svg, zoom, g;

// Called by main.js when fullscreen state changes
function setWheelZoomEnabled(enabled) {
  zoom.filter(enabled
    ? event => !event.ctrlKey && !event.button
    : event => event.type !== 'wheel' && !event.ctrlKey && !event.button
  );
}

// 1. STRUCTURAL DATA — hub and category nodes stay hardcoded
const structuralNodes = [
  { id: "hub",                name: "Workforce Asset Map",                type: "hub",         size: 25, image: "" },
  { id: "colleges",           name: "Colleges",                           type: "major-group", size: 18, image: "" },
  { id: "faith-based",        name: "Faith Based",                        type: "major-group", size: 18, image: "" },
  { id: "special-population", name: "Special Population and Re Entry",    type: "major-group", size: 18, image: "" },
  { id: "job-training",       name: "Job Training and Career Services",   type: "major-group", size: 18, image: "" },
  { id: "community-dev",      name: "Community and Economic Development", type: "major-group", size: 18, image: "" },
  { id: "k12-secondary",      name: "K-12 and Secondary",                 type: "major-group", size: 18, image: "" }
];

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
    size: data.size || 12,
    image: data.image || ""
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
        return (d.source.type === "hub" || d.target.type === "hub") ? 35 : 105;
    }))
    .force("charge", d3.forceManyBody().strength(-400))
    .force("center", d3.forceCenter(width / 2, height / 2));

  const link = g.append("g").selectAll("line").data(workforceData.links).join("line")
    .attr("stroke", "#666").attr("stroke-width", d => d.source.type === "hub" ? 3 : 1.5).attr("stroke-opacity", 0.6);

  const node = g.append("g").selectAll("g").data(workforceData.nodes).join("g")
    .call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended));

  node.append("circle").attr("r", d => d.size).attr("fill", d => colorScale(d.type)).attr("stroke", "#fff")
    .attr("stroke-width", 2).attr("stroke-dasharray", d => d.image ? "0" : "5,5").attr("opacity", 0.9);

  node.append("text").text(d => d.name).attr("dy", d => d.size + 18).attr("text-anchor", "middle").attr("fill", "#fff")
    .attr("font-size", d => d.type === "hub" ? "14px" : "11px").style("text-shadow", "1px 1px 2px rgba(0,0,0,0.8)");

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
