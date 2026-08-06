/* ===== UI CONTROLS & EVENT LISTENERS ===== */

let hubDistance = 28;
const assetRatio = 3.0;
let currentSizeScale = 1; // 1 = the map's normal/default node size (see originalSizes in viz-engine.js)

// Sliders (below-viz controls)
const hubDistanceSlider = document.getElementById('hub-distance-slider');
const sizeSlider = document.getElementById('size-slider');

// Fullscreen inline controls
const fsControls    = document.getElementById('viz-fs-controls');
const fsHubSlider   = document.getElementById('fs-hub-slider');
const fsSizeSlider  = document.getElementById('fs-size-slider');
const fsHubValue    = document.getElementById('fs-hub-value');
const fsSizeValue   = document.getElementById('fs-size-value');

// Helper: apply size change and sync all size UI
function applySizeScale(val) {
    currentSizeScale = val;
    if (sizeSlider)  sizeSlider.value = val;
    if (fsSizeSlider) fsSizeSlider.value = val;
    document.getElementById('size-value').textContent = val.toFixed(1);
    if (fsSizeValue) fsSizeValue.textContent = val.toFixed(1);
    d3.selectAll('.asset-node circle, g circle:not(.flow-particle):not(.branch-node-circle)')
        .transition().duration(200)
        .attr('r', d => originalSizes[d.id] * currentSizeScale);
    d3.selectAll('g image')
        .transition().duration(200)
        .attr('x',      d => -(originalSizes[d.id] * currentSizeScale))
        .attr('y',      d => -(originalSizes[d.id] * currentSizeScale))
        .attr('width',  d =>   originalSizes[d.id] * currentSizeScale * 2)
        .attr('height', d =>   originalSizes[d.id] * currentSizeScale * 2);
    d3.selectAll('defs clipPath circle')
        .attr('r', function() {
            const clipId = d3.select(this.parentNode).attr('id'); // e.g. "clip-mercer"
            const nodeId = clipId.replace('clip-', '');
            return (originalSizes[nodeId] || 12) * currentSizeScale;
        });
    d3.selectAll('g.node-icon')
        .attr('transform', function(d) {
            const size  = originalSizes[d.id] * currentSizeScale;
            const scale = (size * 1.4) / 24;
            return `translate(${-12 * scale},${-12 * scale}) scale(${scale})`;
        });
    d3.selectAll('g text.node-label')
        .transition().duration(200)
        .attr('dy', d => (originalSizes[d.id] * currentSizeScale) + 18);
    d3.selectAll('g.node-hub-mark')
        .transition().duration(200)
        .attr('transform', d => {
            const size = originalSizes[d.id] * currentSizeScale;
            return `scale(${(size * 0.9) / 183.5}) translate(-200,-200)`;
        });
}

// Helper: apply hub distance change and sync all hub UI
function applyHubDistance(val) {
    hubDistance = val;
    if (hubDistanceSlider) hubDistanceSlider.value = val;
    if (fsHubSlider) fsHubSlider.value = val;
    document.getElementById('hub-distance-value').textContent = val;
    if (fsHubValue) fsHubValue.textContent = val;
    updateDistances();
}

if (hubDistanceSlider) {
    hubDistanceSlider.addEventListener('input', function() {
        applyHubDistance(parseInt(this.value));
    });
}

if (sizeSlider) {
    sizeSlider.addEventListener('input', function() {
        applySizeScale(parseFloat(this.value));
    });
}

if (fsHubSlider) {
    fsHubSlider.addEventListener('input', function() {
        applyHubDistance(parseInt(this.value));
    });
}

if (fsSizeSlider) {
    fsSizeSlider.addEventListener('input', function() {
        applySizeScale(parseFloat(this.value));
    });
}

function updateDistances() {
    simulation.force("link").distance(d => {
        return (d.source.type === "hub" || d.target.type === "hub") ? hubDistance : (hubDistance * assetRatio);
    });
    const chargeStrength = -300 * ((hubDistance * (1 + assetRatio) / 2) / 100);
    simulation.force("charge", d3.forceManyBody().strength(chargeStrength));
    simulation.alpha(0.4).restart();
}

// ===== VIZ CONTAINER =====
const vizContainer  = document.getElementById('network-visualization');
const fullscreenBtn = document.getElementById('fullscreen-btn');

// ===== VIZ RESIZE HANDLER =====
function fitVizToContainer() {
    const r = vizContainer.getBoundingClientRect();
    d3.select('#network-visualization svg')
        .attr('viewBox', `0 0 ${r.width} ${r.height}`);
    // Re-frame the camera (pan+zoom) to the new container size, rather than
    // moving the force simulation's own center — fitVizView already frames
    // wherever the nodes currently sit, so also re-centering the simulation
    // here would animate the nodes toward a second, different target at the
    // same time and the two would race, cropping the graph mid-transition.
    fitVizView(600);
}

// A host page embedding the map in an <iframe> can resize that iframe at any
// time (responsive layout, orientation change, etc.) — fitVizToContainer was
// previously only ever called on fullscreen enter/exit, so the map wouldn't
// re-fit if the embedding page resized the iframe element itself. rAF-debounced
// so a drag-resize doesn't thrash the viewBox/camera reframe on every tick.
if (window.ResizeObserver) {
    let vizResizeRAF = null;
    new ResizeObserver(() => {
        if (vizResizeRAF) cancelAnimationFrame(vizResizeRAF);
        vizResizeRAF = requestAnimationFrame(fitVizToContainer);
    }).observe(vizContainer);
}

// ===== ZOOM BUTTONS =====
const zoomInBtn       = document.getElementById('zoom-in-btn');
const zoomOutBtn      = document.getElementById('zoom-out-btn');
const vizZoomControls = document.getElementById('viz-zoom-controls');

if (zoomInBtn)  zoomInBtn.addEventListener('click',  () => zoom.scaleBy(svg.transition().duration(300), 1.3));
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoom.scaleBy(svg.transition().duration(300), 1 / 1.3));

// ===== OVERLAP DETECTION: fs-controls vs zoom controls =====
// Uses hypothetical centered position (not current DOM position) to avoid the check
// locking once the bar shifts. When overlap detected, right-aligns fs-controls so
// its right edge matches the zoom controls' right edge.
function adjustZoomForOverlap() {
    if (!fsControls || !vizZoomControls) return;
    if (fsControls.style.display === 'none' || !isFullscreen) {
        vizZoomControls.style.top = '';
        fsControls.style.left      = '';
        fsControls.style.right     = '';
        fsControls.style.transform = '';
        return;
    }

    const containerRect = vizContainer.getBoundingClientRect();
    const zoomRect      = vizZoomControls.getBoundingClientRect();
    const fsWidth       = fsControls.offsetWidth;

    // Where the right edge of fs-controls would be if perfectly centered
    const centeredRight = containerRect.left + containerRect.width / 2 + fsWidth / 2;

    if (centeredRight >= zoomRect.left) {
        // Would overlap — right-align fs-controls to match zoom controls' right edge,
        // then drop zoom controls below it
        fsControls.style.left      = 'auto';
        fsControls.style.right     = '0.75rem';
        fsControls.style.transform = 'none';

        const containerTop = containerRect.top;
        const fsBottom     = fsControls.getBoundingClientRect().bottom;
        vizZoomControls.style.top = (fsBottom - containerTop + 8) + 'px';
    } else {
        // No overlap — restore centered position and zoom controls default
        vizZoomControls.style.top = '';
        fsControls.style.left      = '';
        fsControls.style.right     = '';
        fsControls.style.transform = '';
    }
}

window.addEventListener('resize', adjustZoomForOverlap);

// ===== FULLSCREEN TOGGLE =====
let isFullscreen = false;

function setFullscreenControls(active) {
    if (fsControls) fsControls.style.display = active ? 'flex' : 'none';
    requestAnimationFrame(adjustZoomForOverlap);
}

function enterFullscreen() {
    isFullscreen = true;
    vizContainer.classList.add('fullscreen', 'interactive');
    fullscreenBtn.textContent = '\u2715';
    document.body.style.overflow = 'hidden';
    setWheelZoomEnabled(true);
    setFullscreenControls(true);
    requestAnimationFrame(fitVizToContainer);
}

function exitFullscreen() {
    isFullscreen = false;
    vizContainer.classList.remove('fullscreen', 'interactive');
    fullscreenBtn.textContent = '\u26F6';
    document.body.style.overflow = '';
    setWheelZoomEnabled(false);
    setFullscreenControls(false);
    requestAnimationFrame(() => { fitVizToContainer(); adjustZoomForOverlap(); });
}

if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', function() {
        isFullscreen ? exitFullscreen() : enterFullscreen();
    });
}

// ESC exits fullscreen
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isFullscreen) exitFullscreen();
});

// ===== SHARED RESET LOGIC =====
function doReset() {
    collapseBranch(0); // clear any focused node/satellites first, or they'd be left stranded mid-reset
    const panel = document.getElementById('viz-info-panel');
    if (panel) panel.classList.remove('open');
    applyHubDistance(28);
    applySizeScale(1);
    resetVizLayout(750); // snaps every node back to its page-load position, then reframes
}

const resetBtn = document.getElementById('reset-btn');
if (resetBtn) resetBtn.addEventListener('click', doReset);

const fsResetBtn = document.getElementById('fs-reset-btn');
if (fsResetBtn) fsResetBtn.addEventListener('click', doReset);
