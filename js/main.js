/* ===== UI CONTROLS & EVENT LISTENERS ===== */

let hubDistance = 35;
const assetRatio = 3.0;
let currentSizeScale = 1;

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
    d3.selectAll('.asset-node circle, g circle')
        .transition().duration(200)
        .attr('r', d => originalSizes[d.id] * currentSizeScale);
    d3.selectAll('g text')
        .transition().duration(200)
        .attr('dy', d => (originalSizes[d.id] * currentSizeScale) + 18);
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

// ===== MOBILE SCROLL PROTECTION & FULLSCREEN =====
const vizContainer = document.getElementById('network-visualization');
const vizOverlay   = document.getElementById('viz-overlay');
const vizExitBtn   = document.getElementById('viz-exit-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const mobileQuery  = window.matchMedia('(pointer: coarse)');

function enterInteractiveMode() {
    vizContainer.classList.add('interactive');
    if (vizOverlay)  vizOverlay.style.display  = 'none';
    if (vizExitBtn)  vizExitBtn.style.display  = 'block';
    document.body.style.overflow = 'hidden';
}

function exitInteractiveMode() {
    vizContainer.classList.remove('interactive');
    // Restore overlay only on mobile — desktop never shows it
    if (vizOverlay)  vizOverlay.style.display  = mobileQuery.matches ? 'flex' : 'none';
    if (vizExitBtn)  vizExitBtn.style.display  = '';
    document.body.style.overflow = '';
}

// Initialize: force-hide overlay on desktop regardless of CSS
if (vizOverlay) {
    vizOverlay.style.display = mobileQuery.matches ? 'flex' : 'none';

    if (mobileQuery.matches) {
        vizOverlay.addEventListener('click', enterInteractiveMode);
        vizOverlay.addEventListener('touchend', function(e) {
            e.preventDefault();
            enterInteractiveMode();
        }, { passive: false });
    }
}

if (vizExitBtn) {
    vizExitBtn.addEventListener('click', exitInteractiveMode);
}

// Keep in sync if user resizes across the breakpoint
mobileQuery.addEventListener('change', function(e) {
    if (!e.matches) {
        // Crossed to desktop — ensure overlay is gone and scroll is restored
        exitInteractiveMode();
        if (vizOverlay) vizOverlay.style.display = 'none';
    } else {
        if (vizOverlay) vizOverlay.style.display = 'flex';
    }
});

// ===== VIZ RESIZE HANDLER =====
function fitVizToContainer() {
    const r = vizContainer.getBoundingClientRect();
    d3.select('#network-visualization svg')
        .attr('viewBox', `0 0 ${r.width} ${r.height}`);
    simulation
        .force('center', d3.forceCenter(r.width / 2, r.height / 2))
        .alpha(0.3).restart();
}

// ===== ZOOM BUTTONS =====
const zoomInBtn      = document.getElementById('zoom-in-btn');
const zoomOutBtn     = document.getElementById('zoom-out-btn');
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

    const containerRect  = vizContainer.getBoundingClientRect();
    const zoomRect       = vizZoomControls.getBoundingClientRect();
    const fsWidth        = fsControls.offsetWidth;

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

// Fullscreen toggle
let isFullscreen = false;

function setFullscreenControls(active) {
    if (fsControls) fsControls.style.display = active ? 'flex' : 'none';
    requestAnimationFrame(adjustZoomForOverlap);
}

if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', function() {
        isFullscreen = !isFullscreen;
        vizContainer.classList.toggle('fullscreen', isFullscreen);
        fullscreenBtn.textContent = isFullscreen ? '\u2715' : '\u26F6';
        setWheelZoomEnabled(isFullscreen);
        setFullscreenControls(isFullscreen);
        requestAnimationFrame(fitVizToContainer);
    });
}

// ESC exits both interactive and fullscreen states
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        if (isFullscreen) {
            isFullscreen = false;
            vizContainer.classList.remove('fullscreen');
            fullscreenBtn.textContent = '\u26F6';
            setWheelZoomEnabled(false);
            setFullscreenControls(false);
            requestAnimationFrame(() => { fitVizToContainer(); adjustZoomForOverlap(); });
        }
        exitInteractiveMode();
    }
});

// Shared reset logic
function doReset() {
    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
    applyHubDistance(35);
    applySizeScale(1);
}

// Below-viz reset button
const resetBtn = document.getElementById('reset-btn');
if (resetBtn) {
    resetBtn.addEventListener('click', doReset);
}

// Fullscreen reset button
const fsResetBtn = document.getElementById('fs-reset-btn');
if (fsResetBtn) {
    fsResetBtn.addEventListener('click', doReset);
}
