/* ===== DIRECTORY & MODAL LOGIC ===== */

let assetData = {}; // Global store for data fetched from JSON

/**
 * 1. DATA LOADING
 * Pulls the written information from /content/assets.json
 */
async function loadAssetData() {
    try {
        const response = await fetch('content/assets.json');
        if (!response.ok) throw new Error('Network response was not ok');
        
        assetData = await response.json();
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
function setupModalListeners() {
    // Add click handlers to all directory links
    document.querySelectorAll('.asset-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const assetId = link.getAttribute('href').substring(1);
            openAssetModal(assetId);
        });
    });

    // Close inline viz panel
    const vizInfoClose = document.getElementById('viz-info-close');
    if (vizInfoClose) {
        vizInfoClose.onclick = () => {
            document.getElementById('viz-info-panel').classList.remove('open');
            collapseBranch(); // tear down any branched-out related-program nodes too
        };
    }

    const modal = document.getElementById('asset-modal');
    const closeBtn = document.querySelector('.close');

    // Close modal on 'X' click
    if (closeBtn) {
        closeBtn.onclick = () => modal.style.display = 'none';
    }

    // Close modal on clicking outside the box
    window.onclick = (event) => {
        if (event.target == modal) modal.style.display = "none";
    };

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'block') {
            modal.style.display = 'none';
        }
    });
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