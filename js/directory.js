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

function openAssetModal(assetId) {
    const modal = document.getElementById('asset-modal');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');
    
    if (!modal || !title || !content) return;

    const asset = assetData[assetId];
    
    if (asset) {
        title.textContent = asset.name;
        
        // Build the HTML string piece by piece
        let html = `<p>${asset.description || ''}</p>`;
        
        // Check if "impact" exists in the JSON for this asset
        if (asset.impact) {
            html += `<p><strong>Community Impact:</strong> ${asset.impact}</p>`;
        }
        
        // Add the website link
        if (asset.website) {
            html += `<p><strong>Website:</strong> <a href="${asset.website}" target="_blank">${asset.website.replace('https://', '')}</a></p>`;
        }
        
        content.innerHTML = html;
    } else {
        title.textContent = 'Asset Information';
        content.innerHTML = '<p>Information coming soon...</p>';
    }
    
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