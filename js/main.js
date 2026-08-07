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
    // Guards against redundant re-fits on truly no-op sub-pixel size
    // changes (e.g. a scrollbar toggling elsewhere on the page). The
    // container's own height is fixed via CSS (css/viz.css), so this
    // isn't compensating for anything unstable — just avoiding pointless
    // work when the observed size hasn't actually moved.
    let lastVizWidth = null, lastVizHeight = null;
    new ResizeObserver(() => {
        const r = vizContainer.getBoundingClientRect();
        if (lastVizWidth !== null && Math.abs(r.width - lastVizWidth) < 1 && Math.abs(r.height - lastVizHeight) < 1) return;
        lastVizWidth = r.width;
        lastVizHeight = r.height;
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
// locking once the bar shifts. vizZoomControls (search/zoom/fullscreen-exit) never
// moves — it's the one control a user in fullscreen actually needs to find reliably
// to get back out, so it always stays pinned at its default top-right spot. When
// overlap is detected, fs-controls (Size/Hub Distance/Reset) is the one that drops
// below it instead. Gated on fs-controls actually being rendered rather than on
// isFullscreen, since map-only embed mode shows fs-controls even outside fullscreen
// (see setFullscreenControls) and still needs the same collision handling there.
function adjustZoomForOverlap() {
    if (!fsControls || !vizZoomControls) return;
    if (fsControls.style.display === 'none') {
        fsControls.style.top       = '';
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
        // Would overlap — right-align fs-controls to match zoom controls' right
        // edge, then drop it below the (untouched) zoom controls column.
        fsControls.style.left      = 'auto';
        fsControls.style.right     = '0.75rem';
        fsControls.style.transform = 'none';
        fsControls.style.top       = (zoomRect.bottom - containerRect.top + 8) + 'px';
    } else {
        // No overlap — restore centered position
        fsControls.style.top       = '';
        fsControls.style.left      = '';
        fsControls.style.right     = '';
        fsControls.style.transform = '';
    }
}

window.addEventListener('resize', adjustZoomForOverlap);

// ===== FULLSCREEN TOGGLE =====
let isFullscreen = false;
// Tracks whether the real Fullscreen API is the thing actually driving the
// current fullscreen state (as opposed to the CSS-only fallback below) \u2014
// needed because requestFullscreen() can fail (no <iframe allowfullscreen>,
// unsupported browser, automation contexts, etc.) and a failed/no-op
// request can still dispatch a fullscreenchange event, which would
// otherwise be indistinguishable from a genuine user exit.
let realFullscreenActive = false;

function setFullscreenControls(active) {
    // Map-only embed mode shows fs-controls (Size/Hub Distance/Reset) as an
    // overlay bar at all times \u2014 mirroring the same position/style the
    // regular map uses only in fullscreen \u2014 rather than the normal page's
    // separate row below the map, so it's shown here whenever active OR
    // we're in embed mode, not just while actually fullscreen.
    const show = active || document.body.classList.contains('embed-mode');
    if (fsControls) fsControls.style.display = show ? 'flex' : 'none';
    requestAnimationFrame(adjustZoomForOverlap);
}

function applyFullscreenVisuals(active) {
    isFullscreen = active;
    vizContainer.classList.toggle('fullscreen', active);
    vizContainer.classList.toggle('interactive', active);
    fullscreenBtn.textContent = active ? '\u2715' : '\u26F6';
    document.body.style.overflow = active ? 'hidden' : '';
    setWheelZoomEnabled(active);
    setFullscreenControls(active);
    requestAnimationFrame(() => {
        fitVizToContainer();
        if (!active) adjustZoomForOverlap();
    });
}

function enterFullscreen() {
    if (isFullscreen) return;

    // Map-only embeds: escape the host iframe and take over the whole
    // browser via the real Fullscreen API, rather than just filling the
    // iframe's own (often small) box via the CSS-only approach below.
    // Request it BEFORE touching any of our own layout/classes \u2014 applying
    // position:fixed/100vw/100vh at the same moment the browser is
    // processing the fullscreen transition caused Chrome to immediately
    // revert back out of fullscreen in testing. Letting fullscreenchange
    // (below) drive our visuals only once the real transition actually
    // completes avoids that race entirely. Needs the partner's <iframe
    // allowfullscreen>; if that's missing (or the API fails for any other
    // reason) we fall through to the CSS-only approach exactly as before.
    if (document.body.classList.contains('embed-mode') && vizContainer.requestFullscreen) {
        vizContainer.requestFullscreen()
            .then(() => { realFullscreenActive = true; })
            .catch(() => { applyFullscreenVisuals(true); });
        return;
    }

    applyFullscreenVisuals(true);
}

function exitFullscreen() {
    if (!isFullscreen) return;
    if (realFullscreenActive) {
        realFullscreenActive = false;
        if (document.fullscreenElement === vizContainer) {
            document.exitFullscreen().catch(() => {});
        }
        // applyFullscreenVisuals(false) runs via the fullscreenchange
        // listener below once the real exit actually completes, same
        // reasoning as the entry path above.
    } else {
        applyFullscreenVisuals(false);
    }
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

// The real Fullscreen API drives its own transitions (including ESC/browser
// UI exits) without going through enter/exitFullscreen() above \u2014 this is
// the single source of truth for our visuals whenever realFullscreenActive,
// so both directions stay in sync with what the browser actually did.
document.addEventListener('fullscreenchange', function() {
    if (document.fullscreenElement === vizContainer) {
        applyFullscreenVisuals(true);
    } else if (realFullscreenActive) {
        realFullscreenActive = false;
        applyFullscreenVisuals(false);
    }
});

// Map-only embed mode shows fs-controls immediately (see
// setFullscreenControls), not just after a first fullscreen toggle.
setFullscreenControls(false);

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
