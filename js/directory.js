/* ===== DIRECTORY & MODAL LOGIC ===== */

let assetData = {}; // Global store for data fetched from JSON

// Section order + heading text for the Directory page — matches the 6
// categories used everywhere else (admin builder's dropdown, viz-engine.js's
// CATEGORY_COLORS). The Directory list used to be hand-written HTML that
// silently went stale the moment a node was published anywhere else;
// building it from assetData here means publishing a node updates the map,
// map search, Directory listing, and Directory search all from the same
// one write to assets.json, instead of needing a second manual HTML edit.
const DIRECTORY_CATEGORIES = [
    { slug: 'colleges',           heading: 'Higher Education Institutions, Colleges & Universities' },
    { slug: 'k12-secondary',      heading: 'Secondary Education & Career Academy Programs (K-12)' },
    { slug: 'community-dev',      heading: 'Community & Economic Development Partners' },
    { slug: 'job-training',       heading: 'Job Training & Career Services, Adult & Workforce Programs' },
    { slug: 'faith-based',        heading: 'Faith-Based and Community Workforce Initiatives' },
    { slug: 'special-population', heading: 'Special Population & Re-entry Programs' }
];

function escapeHtmlDir(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// No-ops on index.html (loads this same file for openAssetModal/etc. but
// has no .directory-grid) — only the actual Directory page has one.
// Preserves assets.json's own key order within each category (whatever
// order entries were added/published in) rather than re-sorting, so
// existing entries don't visibly reshuffle just from switching this from
// static HTML to a dynamic render.
function renderDirectoryList() {
    const grid = document.querySelector('.directory-grid');
    if (!grid) return;

    grid.innerHTML = DIRECTORY_CATEGORIES.map(({ slug, heading }) => {
        const entries = Object.entries(assetData).filter(([, d]) => d.category === slug);
        if (!entries.length) return '';
        const items = entries.map(([id, d]) => `<li><a href="#${id}" class="asset-link">${escapeHtmlDir(d.name)}</a></li>`).join('');
        return `
                <section class="directory-group">
                    <h3>${escapeHtmlDir(heading)}</h3>
                    <ul class="asset-list">${items}</ul>
                </section>`;
    }).join('');
}

/**
 * 1. DATA LOADING
 * Pulls the written information from /content/assets.json
 */
async function loadAssetData() {
    try {
        const response = await fetch('content/assets.json');
        if (!response.ok) throw new Error('Network response was not ok');
        
        assetData = await response.json();

        // Same draft-preview mechanism as viz-engine.js — merges an
        // unpublished node stashed by the admin tools' "Preview on Map"
        // button so its info panel shows real content, never touching
        // assets.json itself.
        const previewId = new URLSearchParams(window.location.search).get('preview');
        if (previewId) {
            try {
                const draft = JSON.parse(sessionStorage.getItem('wf_preview_node') || 'null');
                if (draft && draft.id === previewId) assetData[draft.id] = draft.data;
            } catch (err) {
                console.error('directory: could not parse preview draft', err);
            }
        }

        // Renders (a no-op on index.html) then wires clicks on the links it
        // just created — has to happen in this order and after the fetch
        // resolves, not alongside it, since the links don't exist yet
        // beforehand.
        renderDirectoryList();
        wireAssetLinks();

        console.log("Asset data loaded successfully");

        // Only check for URL parameters (from map clicks) AFTER data is ready
        checkUrlParameters();
    } catch (error) {
        console.error("Error loading asset JSON:", error);
    }
}

/**
 * 2. INITIALIZATION
 * Runs when the page loads
 */
document.addEventListener('DOMContentLoaded', () => {
    loadAssetData();
    setupModalListeners();
});

/**
 * 3. UI FUNCTIONS
 */
function wireAssetLinks() {
    document.querySelectorAll('.asset-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const assetId = link.getAttribute('href').substring(1);
            openAssetModal(assetId);
        });
    });
}

function setupModalListeners() {
    // Close inline viz panel
    const vizInfoClose = document.getElementById('viz-info-close');
    if (vizInfoClose) {
        vizInfoClose.onclick = () => {
            document.getElementById('viz-info-panel').classList.remove('open');
            // On mobile, leaving the panel resets the whole map back to the
            // core ring — not just the branched-out asset that opened it —
            // since an expanded category can still be sitting open
            // underneath (tap a category, tap one of its children, then
            // close the panel: collapseBranch alone tore down the child's
            // satellites but left the category itself expanded). Desktop
            // has no category-collapse concept to reset, so it keeps the
            // narrower, branch-only teardown.
            if (window.innerWidth <= 768 && typeof dismissMobileFocus === 'function') dismissMobileFocus();
            else collapseBranch(); // tear down any branched-out related-program nodes too
        };
    }

    const modal = document.getElementById('asset-modal');
    const closeBtn = document.querySelector('.close');

    // Close modal on 'X' click
    if (closeBtn) {
        closeBtn.onclick = () => closeAssetModal(modal);
    }

    // Close modal on clicking outside the box
    window.onclick = (event) => {
        if (event.target == modal) closeAssetModal(modal);
    };

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'block') {
            closeAssetModal(modal);
        }
    });
}

// iOS Safari lets a touch drag scroll the body behind a position:fixed
// overlay even though the overlay covers the whole viewport — locking
// body overflow while the modal's open (and restoring it on every close
// path) keeps that scroll on the modal's own .modal-body instead.
function closeAssetModal(modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

// Shows just the domain instead of the full URL — a full path (e.g.
// "www.mga.edu/center-career-leadership-development/index.php") is long
// enough to overflow the fixed-width info panel/modal.
function shortenUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
        return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
}

function openAssetModal(assetId) {
    const asset = assetData[assetId];
    const inlinePanel  = document.getElementById('viz-info-panel');

    // Build shared HTML content
    let html = `<p>${asset ? (asset.description || '') : 'Information coming soon...'}</p>`;
    if (asset && asset.impact)   html += `<p><strong>Community Impact:</strong> ${asset.impact}</p>`;
    if (asset && asset.links && asset.links.length) {
        html += `<p><strong>Related Programs:</strong></p><div class="related-links">`;
        html += asset.links.map(l => `<a href="${l.url}" target="_blank">${l.label}</a>`).join('');
        html += `</div>`;
    }
    if (asset && asset.website)  html += `<p><strong>Website:</strong> <a href="${asset.website}" target="_blank">${shortenUrl(asset.website)}</a></p>`;

    // Use inline panel when it exists (orientation handles portrait/landscape layout)
    if (inlinePanel) {
        document.getElementById('viz-info-title').textContent = asset ? asset.name : 'Asset Information';
        document.getElementById('viz-info-body').innerHTML = html;
        // Without this, clicking a different node while scrolled down keeps
        // the old scroll offset — the new content jumps in mid-scroll instead
        // of opening at the top.
        inlinePanel.scrollTop = 0;
        inlinePanel.classList.add('open');
        return;
    }

    // Directory page (no inline panel): use the regular fixed modal
    const modal   = document.getElementById('asset-modal');
    const title   = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');
    if (!modal || !title || !content) return;

    title.textContent  = asset ? asset.name : 'Asset Information';
    content.innerHTML  = html;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function checkUrlParameters() {
    // Allows the Map page to link directly to a specific modal
    const urlParams = new URLSearchParams(window.location.search);
    const assetId = urlParams.get('asset');
    
    if (assetId) {
        openAssetModal(assetId);
        // Clean up URL in browser bar without reloading the page
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}