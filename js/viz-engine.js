/* ===== D3.JS NEURAL NETWORK ENGINE ===== */

// 1. DATA STRUCTURE
const workforceData = {
  nodes: [
    { id: "hub", name: "Workforce Asset Map", type: "hub", size: 25, image: "" },
    { id: "colleges", name: "Colleges", type: "major-group", size: 18, image: "" },
    { id: "faith-based", name: "Faith Based", type: "major-group", size: 18, image: "" },
    { id: "special-population", name: "Special Population and Re Entry", type: "major-group", size: 18, image: "" },
    { id: "job-training", name: "Job Training and Career Services", type: "major-group", size: 18, image: "" },
    { id: "community-dev", name: "Community and Economic Development", type: "major-group", size: 18, image: "" },
    { id: "k12-secondary", name: "K-12 and Secondary", type: "major-group", size: 18, image: "" },
    { id: "mercer", name: "Mercer", type: "asset", size: 12, image: "" },
    { id: "wesleyan", name: "Wesleyan", type: "asset", size: 12, image: "" },
    { id: "central-ga-tech", name: "Central GA Technical College", type: "asset", size: 12, image: "" },
    { id: "middle-ga-state", name: "Middle Georgia State", type: "asset", size: 12, image: "" },
    { id: "hutchings", name: "Hutchings Career Academy", type: "asset", size: 12, image: "" },
    { id: "bibb-schools", name: "Bibb County Schools", type: "asset", size: 12, image: "" },
    { id: "chamber", name: "Greater Macon Chamber of Commerce", type: "asset", size: 12, image: "" },
    { id: "mbcia", name: "Macon Bibb Industrial Authority", type: "asset", size: 12, image: "" },
    { id: "choose-macon", name: "Choose Macon", type: "asset", size: 12, image: "" },
    { id: "library", name: "Bibb County Library System", type: "asset", size: 12, image: "" },
    { id: "workforce-alliance", name: "Workforce Alliance", type: "asset", size: 12, image: "" },
    { id: "newtown", name: "Newtown Macon", type: "asset", size: 12, image: "" },
    { id: "ga-dol", name: "Georgia Department of Labor", type: "asset", size: 12, image: "" },
    { id: "goodwill", name: "Goodwill", type: "asset", size: 12, image: "" },
    { id: "eckerd", name: "Eckerd Connects", type: "asset", size: 12, image: "" },
    { id: "ibew", name: "IBEW", type: "asset", size: 12, image: "" },
    { id: "job-corps", name: "Job Corps", type: "asset", size: 12, image: "" },
    { id: "arc-macon", name: "Arc Macon", type: "asset", size: 12, image: "" },
    { id: "greater-career-works", name: "Greater Career Works", type: "asset", size: 12, image: "" },
    { id: "salvation-army", name: "Salvation Army", type: "asset", size: 12, image: "" },
    { id: "rescue-mission", name: "Rescue Mission", type: "asset", size: 12, image: "" },
    { id: "other-faith", name: "Other", type: "asset", size: 12, image: "" },
    { id: "transitional-center", name: "Transitional Center", type: "asset", size: 12, image: "" },
    { id: "drc", name: "DRC", type: "asset", size: 12, image: "" }
  ],
  links: [
    { source: "hub", target: "colleges" },
    { source: "hub", target: "faith-based" },
    { source: "hub", target: "special-population" },
    { source: "hub", target: "job-training" },
    { source: "hub", target: "community-dev" },
    { source: "hub", target: "k12-secondary" },
    { source: "mercer", target: "colleges" },
    { source: "wesleyan", target: "colleges" },
    { source: "central-ga-tech", target: "colleges" },
    { source: "middle-ga-state", target: "colleges" },
    { source: "hutchings", target: "k12-secondary" },
    { source: "bibb-schools", target: "k12-secondary" },
    { source: "chamber", target: "community-dev" },
    { source: "mbcia", target: "community-dev" },
    { source: "choose-macon", target: "community-dev" },
    { source: "library", target: "community-dev" },
    { source: "workforce-alliance", target: "community-dev" },
    { source: "newtown", target: "community-dev" },
    { source: "ga-dol", target: "job-training" },
    { source: "goodwill", target: "job-training" },
    { source: "eckerd", target: "job-training" },
    { source: "ibew", target: "job-training" },
    { source: "job-corps", target: "job-training" },
    { source: "arc-macon", target: "job-training" },
    { source: "greater-career-works", target: "job-training" },
    { source: "salvation-army", target: "faith-based" },
    { source: "rescue-mission", target: "faith-based" },
    { source: "other-faith", target: "faith-based" },
    { source: "transitional-center", target: "special-population" },
    { source: "drc", target: "special-population" }
  ]
};

// 2. INITIALIZATION
const originalSizes = {};
workforceData.nodes.forEach(node => { originalSizes[node.id] = node.size; });

const container = d3.select("#network-visualization");
const width = container.node().getBoundingClientRect().width;
const height = 720; // Fixed height for consistency

const svg = container.append("svg")
  .attr("width", "100%")
  .attr("height", "100%")
  .attr("viewBox", `0 0 ${width} ${height}`);

const zoom = d3.zoom()
  .scaleExtent([0.3, 3])
  .filter(event => event.type !== 'wheel' && !event.ctrlKey && !event.button)
  .on("zoom", (event) => { g.attr("transform", event.transform); });
svg.call(zoom);

// Called by main.js when fullscreen state changes
function setWheelZoomEnabled(enabled) {
  zoom.filter(enabled
    ? event => !event.ctrlKey && !event.button
    : event => event.type !== 'wheel' && !event.ctrlKey && !event.button
  );
}
const g = svg.append("g");

const colorScale = d3.scaleOrdinal()
  .domain(["hub", "major-group", "asset"])
  .range(["#ffffff", "#4a9eff", "#66bb6a"]);

// 3. SIMULATION SETUP
const simulation = d3.forceSimulation(workforceData.nodes)
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
node.on("mouseover", function(e, d) { d3.select(this).select("circle").attr("stroke-width", 4).attr("filter", "brightness(1.3)"); })
    .on("mouseout", function(e, d) { d3.select(this).select("circle").attr("stroke-width", 2).attr("filter", "none"); })
    .on("click", (e, d) => { if (d.type === "asset") openAssetModal(d.id); })
    .style("cursor", d => d.type === "asset" ? "pointer" : "default");

simulation.on("tick", () => {
  link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
  node.attr("transform", d => `translate(${d.x},${d.y})`);
});

function dragstarted(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
function dragended(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }