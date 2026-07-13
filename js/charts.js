(function () {
    'use strict';

    // ===== THEME =====
    const C = {
        accent: '#4a9eff',
        teal:   '#2dd4bf',
    };

    // ===== HELPERS =====
    function parseNum(str) {
        return parseInt(String(str).replace(/,/g, ''), 10);
    }
    function truncate(str, n) {
        return str.length > n ? str.slice(0, n - 1) + '…' : str;
    }

    // Same horizontal bar-row markup used by the Demographics/Occupation
    // Intelligence panels, so these two charts read as part of the same
    // component family instead of a separate SVG-chart style.
    function renderBarRows(containerId, rows, color) {
        const el = document.getElementById(containerId);
        if (!el) return;
        if (!rows.length) { el.innerHTML = ''; return; }

        const max = Math.max(...rows.map(r => r.value));
        el.innerHTML = rows.map(r => `
            <div class="demo-bar-row">
                <div class="demo-bar-label wide-label" title="${r.label}">${truncate(r.label, 34)}</div>
                <div class="demo-bar-track">
                    <div class="demo-bar-fill" style="width:${max ? (r.value / max * 100).toFixed(1) : 0}%;background:${color};"></div>
                </div>
                <div class="occ-bar-val">${r.value.toLocaleString()}</div>
            </div>`).join('');
    }

    // ===== SHORT NAME LOOKUP (industry labels) =====
    const SHORT_NAMES = {
        'Health Care and Social Assistance':                                              'Health Care & Social Assistance',
        'Accommodation and Food Services':                                               'Accommodation & Food',
        'Administrative and Support and Waste Management and Remediation Services':      'Admin & Support Services',
        'Other Services (except Public Administration)':                                 'Other Services',
        'Transportation and Warehousing':                                                'Transportation & Warehousing',
        'Professional, Scientific, and Technical Services':                              'Prof. & Technical Services',
        'Management of Companies and Enterprises':                                       'Management of Companies',
        'Real Estate and Rental and Leasing':                                            'Real Estate & Leasing',
        'Arts, Entertainment, and Recreation':                                           'Arts & Entertainment',
        'Finance and Insurance':                                                         'Finance & Insurance',
    };

    // ===== CHART 1 — TOP HIRING INDUSTRIES =====
    let hiringExpanded = false;
    let hiringAllData  = [];

    function renderHiringChart() {
        const rows = hiringExpanded ? hiringAllData : hiringAllData.slice(0, 10);
        renderBarRows('hiring-chart', rows, C.accent);

        const btn = document.getElementById('hiring-toggle');
        if (btn) btn.textContent = hiringExpanded ? '▲ Show Less' : '▼ Show All Industries';
    }

    function loadHiringChart() {
        d3.csv('data/Top Hiring Industries.csv').then(function (data) {
            hiringAllData = data
                .filter(d => d.Industry && d['Active Job Ads'])
                .map(d => ({ label: SHORT_NAMES[d.Industry] || d.Industry, value: parseNum(d['Active Job Ads']) }))
                .sort((a, b) => b.value - a.value);
            renderHiringChart();

            const btn = document.getElementById('hiring-toggle');
            if (btn) {
                btn.addEventListener('click', function () {
                    hiringExpanded = !hiringExpanded;
                    renderHiringChart();
                });
            }
        });
    }

    // ===== CHART 2 — TOP EMPLOYERS =====
    let employersExpanded = false;
    let employersAllData  = [];

    function renderEmployersChart() {
        const rows = employersExpanded ? employersAllData : employersAllData.slice(0, 10);
        renderBarRows('employers-chart', rows, C.teal);

        const btn = document.getElementById('employers-toggle');
        if (btn) btn.textContent = employersExpanded ? '▲ Show Less' : '▼ Show All Employers';
    }

    function loadEmployersChart() {
        d3.csv('data/Bibb Top Employers.csv').then(function (data) {
            employersAllData = data
                .filter(d => d.Company && d['Active Jobs'])
                .map(d => ({ label: d.Company, value: parseNum(d['Active Jobs']) }))
                .sort((a, b) => b.value - a.value);
            renderEmployersChart();

            const btn = document.getElementById('employers-toggle');
            if (btn) {
                btn.addEventListener('click', function () {
                    employersExpanded = !employersExpanded;
                    renderEmployersChart();
                });
            }
        });
    }

    // ===== LOAD =====
    loadHiringChart();
    loadEmployersChart();

})();
