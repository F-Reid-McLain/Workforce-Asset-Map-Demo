/* ===== UI CONTROLS & EVENT LISTENERS ===== */

let hubDistance = 35;
let assetRatio = 3.0;
let currentSizeScale = 1;

// Sliders
const hubDistanceSlider = document.getElementById('hub-distance-slider');
const assetRatioSlider = document.getElementById('asset-ratio-slider');
const sizeSlider = document.getElementById('size-slider');

if (hubDistanceSlider) {
    hubDistanceSlider.addEventListener('input', function() {
        hubDistance = parseInt(this.value);
        document.getElementById('hub-distance-value').textContent = hubDistance;
        updateDistances();
    });
}

if (assetRatioSlider) {
    assetRatioSlider.addEventListener('input', function() {
        assetRatio = parseFloat(this.value);
        document.getElementById('asset-ratio-value').textContent = assetRatio.toFixed(1);
        updateDistances();
    });
}

if (sizeSlider) {
    sizeSlider.addEventListener('input', function() {
        currentSizeScale = parseFloat(this.value);
        document.getElementById('size-value').textContent = currentSizeScale.toFixed(1);
        
        d3.selectAll('.asset-node circle, g circle')
            .transition().duration(200)
            .attr('r', d => originalSizes[d.id] * currentSizeScale);
        
        d3.selectAll('g text')
            .transition().duration(200)
            .attr('dy', d => (originalSizes[d.id] * currentSizeScale) + 18);
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
const mobileQuery  = window.matchMedia('(max-width: 768px)');

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

// Fullscreen toggle
let isFullscreen = false;

if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', function() {
        isFullscreen = !isFullscreen;
        vizContainer.classList.toggle('fullscreen', isFullscreen);
        fullscreenBtn.textContent = isFullscreen ? '\u2715' : '\u26F6';

        // Let the browser finish resizing, then recenter the simulation
        requestAnimationFrame(function() {
            const r = vizContainer.getBoundingClientRect();
            d3.select('#network-visualization svg')
                .attr('viewBox', `0 0 ${r.width} ${r.height}`);
            simulation
                .force('center', d3.forceCenter(r.width / 2, r.height / 2))
                .alpha(0.3).restart();
        });
    });
}

// ESC exits both interactive and fullscreen states
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        if (isFullscreen) {
            isFullscreen = false;
            vizContainer.classList.remove('fullscreen');
            fullscreenBtn.textContent = '\u26F6';
            requestAnimationFrame(function() {
                const r = vizContainer.getBoundingClientRect();
                d3.select('#network-visualization svg')
                    .attr('viewBox', `0 0 ${r.width} ${r.height}`);
                simulation.force('center', d3.forceCenter(r.width / 2, r.height / 2)).alpha(0.3).restart();
            });
        }
        exitInteractiveMode();
    }
});

// Reset
const resetBtn = document.getElementById('reset-btn');
if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
        hubDistanceSlider.value = 35;
        assetRatioSlider.value = 3.0;
        sizeSlider.value = 1;
        // Trigger logic resets here...
        updateDistances();
    });
}