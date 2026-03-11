/* ===== DASHBOARD & DATA LOGIC ===== */

// 1. DATASET (V1 - Manual Data)
// In Phase 3, this will be fetched via Python/API
const maconStats = {
    population: "157,346",
    laborForce: "74,210",
    unemployment: "3.8%",
    medianIncome: "$43,150",
    jobGrowth: "+2.1%"
};

// 2. INITIALIZE DASHBOARD
document.addEventListener('DOMContentLoaded', () => {
    populateStats();
    handleChartPlaceholders();
});

// 3. FUNCTIONS
function populateStats() {
    // Mapping the data to the HTML IDs
    const mappings = {
        'population-stat': maconStats.population,
        'labor-force-stat': maconStats.laborForce,
        'unemployment-stat': maconStats.unemployment,
        'income-stat': maconStats.medianIncome,
        'job-growth-stat': maconStats.jobGrowth
    };

    for (const [id, value] of Object.entries(mappings)) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }
}

function handleChartPlaceholders() {
    // This looks for chart images with empty sources and 
    // ensures they don't show a "broken image" icon
    const chartImages = document.querySelectorAll('.chart-image');
    chartImages.forEach(img => {
        if (!img.getAttribute('src') || img.getAttribute('src') === "") {
            img.style.display = 'none';
            // Add a placeholder message to the parent container
            const parent = img.parentElement;
            if (parent && !parent.querySelector('.placeholder-msg')) {
                const msg = document.createElement('p');
                msg.className = 'placeholder-msg';
                msg.style.color = '#888';
                msg.style.textAlign = 'center';
                msg.style.paddingTop = '100px';
                msg.textContent = "Data visualization coming soon...";
                parent.appendChild(msg);
            }
        }
    });
}