(function () {
    'use strict';

    // ===== THEME =====
    // accent matches --color-accent (Chamber Gold) in theme.css — kept in
    // sync manually since these charts are hand-rolled SVG/HTML, not CSS.
    const C = {
        accent:        '#afa66d',
        teal:          '#2dd4bf',
        orange:        '#fb923c',
        maconGreen:      '#16a34a', // Regional map — Macon-Bibb County highlight
        maconGreenLight: '#5cdc8b', // lightened — map stroke/highlight text
        lightestGreen:   '#bbf7d0', // Regional map — Wilkinson County (barely-positive net commuting)
        bgSurface:     '#2d2d2d',
        bgSurfaceDeep: '#252525',
        textPrimary:   '#ffffff',
        textSec:       '#cccccc',
        textMuted:     '#888888',
        border:        '#444444',
    };

    const BIBB      = '13021';
    const WILKINSON = '13319'; // only county with positive net commuting right now — called out as the palest green on the regional map

    // ===== HELPERS =====
    function toNum(v) {
        const n = parseFloat(String(v || '').replace(/,/g, '').trim());
        return isNaN(n) ? 0 : n;
    }
    function norm(s) {
        return String(s || '').trim().replace(/\s+/g, ' ');
    }
    function debounce(fn, ms) {
        let t;
        return function () { clearTimeout(t); t = setTimeout(fn, ms); };
    }
    function fips5(v) {
        return String(v).padStart(5, '0');
    }
    function isMobile() {
        return window.innerWidth <= 768;
    }

    // ===== INDUSTRY CONFIG (2-digit NAICS prefix -> sector) =====
    // Colors: the three largest/most-referenced sectors are pinned to the
    // site's actual accent trio (teal/orange/gold) so the treemap ties back
    // to the same brand vocabulary as the rest of the site; the remaining
    // sectors use a golden-angle hue rotation (a fixed ~137.5° step) so that
    // sectors adjacent in the treemap's size-sorted layout stay visually
    // distinct, at a saturation/lightness band that matches the pinned three
    // instead of the old grab-bag of bright Tailwind pastels. Every cell is
    // always directly labeled with its name, so hue is a wayfinding aid here,
    // not the sole identifier — full CVD-safe separation across all 20 isn't
    // the goal the way it would be for a legend-dependent chart.
    const INDUSTRIES = {
        '11': { name: 'Agriculture, Forestry & Fishing',   prefixes: ['11'],           color: '#5857c1' },
        '21': { name: 'Mining & Oil and Gas',               prefixes: ['21'],           color: '#bc5ec9' },
        '22': { name: 'Utilities',                          prefixes: ['22'],           color: '#b9c775' },
        '23': { name: 'Construction',                       prefixes: ['23'],           color: '#a8c775' },
        '31': { name: 'Manufacturing',                      prefixes: ['31', '32', '33'], color: '#7cc775' },
        '42': { name: 'Wholesale Trade',                    prefixes: ['42'],           color: '#c95e63' },
        '44': { name: 'Retail Trade',                       prefixes: ['44', '45'],     color: '#afa66d' },
        '48': { name: 'Transportation & Warehousing',       prefixes: ['48', '49'],     color: '#6e57c1' },
        '51': { name: 'Information',                        prefixes: ['51'],           color: '#c95e9d' },
        '52': { name: 'Finance & Insurance',                prefixes: ['52'],           color: '#5ec98f' },
        '53': { name: 'Real Estate',                        prefixes: ['53'],           color: '#9157c1' },
        '54': { name: 'Professional & Technical Services',  prefixes: ['54'],           color: '#577ac1' },
        '55': { name: 'Management of Companies',            prefixes: ['55'],           color: '#75c78a' },
        '56': { name: 'Administrative & Support',           prefixes: ['56'],           color: '#b275c7' },
        '61': { name: 'Educational Services',                prefixes: ['61'],           color: '#c95e86' },
        '62': { name: 'Health Care & Social Assistance',    prefixes: ['62'],           color: '#2dd4bf' },
        '71': { name: 'Arts & Entertainment',                prefixes: ['71'],           color: '#8dc775' },
        '72': { name: 'Accommodation & Food Services',      prefixes: ['72'],           color: '#fb923c' },
        '81': { name: 'Other Services',                      prefixes: ['81'],           color: '#579ec1' },
        '92': { name: 'Public Administration',                prefixes: ['92'],           color: '#c95ec0' },
    };

    function sectorFor(naics) {
        for (const [id, cfg] of Object.entries(INDUSTRIES)) {
            if (cfg.prefixes.some(p => naics.startsWith(p))) return id;
        }
        return null;
    }

    // ===== HERO KPIs =====
    function loadKPIs(dataRows, totalRow, popRows, commRows) {
        if (totalRow) {
            const jobsEl = document.getElementById('kpi-jobs');
            const wageEl = document.getElementById('kpi-wage');
            if (jobsEl) jobsEl.textContent = Math.round(toNum(totalRow['Empl'])).toLocaleString();
            if (wageEl) wageEl.textContent = '$' + Math.round(toNum(totalRow['Avg Ann Wages'])).toLocaleString();
        }

        const bibbPop  = popRows.find(r => fips5(r.FIPS) === BIBB);
        const bibbComm = commRows.find(r => fips5(r.FIPS) === BIBB);

        if (bibbPop) {
            const popEl = document.getElementById('kpi-pop');
            if (popEl) popEl.textContent = Math.round(toNum(bibbPop.Population)).toLocaleString();
        }
        if (bibbComm) {
            const commEl = document.getElementById('kpi-commute');
            if (commEl) commEl.textContent = '+' + Math.round(toNum(bibbComm.NetCommuting)).toLocaleString();
        }

        const totals = {};
        dataRows.forEach(row => {
            const id = sectorFor((row['NAICS'] || '').trim());
            if (!id) return;
            totals[id] = (totals[id] || 0) + toNum(row['Empl']);
        });
        const topId = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0];
        const topEl = document.getElementById('kpi-top');
        if (topEl) topEl.textContent = topId ? INDUSTRIES[topId].name : '—';
    }

    // ===== TREEMAP =====
    let hierarchy   = null;
    let currentNode = null;

    function buildHierarchy(rows) {
        const groups = {};
        for (const [id, cfg] of Object.entries(INDUSTRIES)) {
            groups[id] = { id, name: cfg.name, color: cfg.color, children: [] };
        }
        for (const row of rows) {
            const naics = (row['NAICS'] || '').trim();
            if (!naics) continue;
            const empl = toNum(row['Empl']);
            if (empl <= 0) continue;
            const id = sectorFor(naics);
            if (!id) continue;
            groups[id].children.push({
                name: (row['Industry'] || '').trim(),
                naics,
                empl,
                wage: toNum(row['Avg Ann Wages']),
            });
        }
        return { name: 'root', children: Object.values(groups).filter(g => g.children.length) };
    }

    function renderTreemap(node) {
        const container = document.getElementById('treemap-canvas');
        if (!container || !node) return;
        currentNode = node;

        const W = container.clientWidth || 900;
        const H = Math.max(360, Math.round(W * 0.45));
        container.style.height = H + 'px';

        const isRoot = node.name === 'root';

        const root = d3.hierarchy(node)
            .sum(d => d.empl || 0)
            .sort((a, b) => b.value - a.value);

        d3.treemap().size([W, H]).padding(isRoot ? 3 : 2).round(true)(root);

        const cells = isRoot ? (root.children || []) : root.leaves();

        const bc   = document.getElementById('treemap-bc');
        const hint = document.getElementById('treemap-hint');
        if (isRoot) {
            bc.innerHTML = '<span class="bc-current">All Industries</span>';
            hint.textContent = 'Click a sector to drill in →';
        } else {
            bc.innerHTML = `<button class="bc-back" id="bc-back-btn">← All Industries</button><span class="bc-sep">›</span><span class="bc-current">${node.name}</span>`;
            hint.textContent = `${cells.length} sub-industries`;
            document.getElementById('bc-back-btn').addEventListener('click', () => renderTreemap(hierarchy));
        }

        container.innerHTML = cells.map((cell, idx) => {
            const w = Math.max(0, cell.x1 - cell.x0);
            const h = Math.max(0, cell.y1 - cell.y0);
            if (w < 4 || h < 4) return '';

            const color   = isRoot ? cell.data.color : (node.color || C.accent);
            const opacity = isRoot ? 0.82 : (0.45 + (cell.value / root.value) * 0.55);
            const showName = w > 56 && h > 24;
            const showEmpl = w > 70 && h > 42;
            const showWage = !isRoot && w > 100 && h > 58 && cell.data.wage > 0;

            return `<div class="treemap-cell${isRoot ? ' drillable' : ''}"
                style="left:${cell.x0}px;top:${cell.y0}px;width:${w}px;height:${h}px;background:${color};opacity:${opacity};"
                data-idx="${idx}"
                title="${cell.data.name}: ${Math.round(cell.value).toLocaleString()} jobs">
                ${showName ? `<div class="tc-name">${cell.data.name}</div>` : ''}
                ${showEmpl ? `<div class="tc-empl">${Math.round(cell.value).toLocaleString()} jobs</div>` : ''}
                ${showWage ? `<div class="tc-empl">$${Math.round(cell.data.wage / 1000)}K avg</div>` : ''}
            </div>`;
        }).join('');

        if (isRoot) {
            container.querySelectorAll('.drillable').forEach(el => {
                el.addEventListener('click', () => {
                    const child = cells[+el.dataset.idx];
                    if (child) renderTreemap(child.data);
                });
            });
        }
    }

    // ===== SHARED HORIZONTAL BAR ROWS (demographics + occupation intelligence) =====
    // Labels are handed to the DOM in full and left to CSS's own
    // white-space/ellipsis truncation (see .demo-bar-label) rather than
    // pre-cut to a fixed character count — a fixed cutoff clips long names
    // even in the wider label columns that have room to show them in full.
    function renderBars(containerId, items, color, formatVal, labelClass) {
        const el = document.getElementById(containerId);
        if (!el || !items.length) { if (el) el.innerHTML = ''; return; }
        const max = Math.max(...items.map(i => i.v));
        const cls = 'demo-bar-label' + (labelClass ? ' ' + labelClass : '');
        el.innerHTML = items.map(({ label, v }) => `
            <div class="demo-bar-row">
                <div class="${cls}" title="${label}">${label}</div>
                <div class="demo-bar-track">
                    <div class="demo-bar-fill" style="width:${max ? (v / max * 100).toFixed(1) : 0}%;background:${color};"></div>
                </div>
                <div class="${formatVal ? 'occ-bar-val' : 'demo-bar-pct'}">${formatVal ? formatVal(v) : (v * 100).toFixed(1) + '%'}</div>
            </div>`).join('');
    }

    // ===== DEMOGRAPHICS =====
    function renderDemographics(demoRows, popRows) {
        const demoMap = {};
        demoRows.forEach(r => { demoMap[norm(r.Metric)] = toNum(r.Value2024); });

        const bibbPop = popRows.find(r => fips5(r.FIPS) === BIBB);
        const popEl   = document.getElementById('demo-population');
        if (popEl) popEl.textContent = bibbPop ? Math.round(toNum(bibbPop.Population)).toLocaleString() : '—';

        const setPct = (id, key) => {
            const el = document.getElementById(id);
            if (el && demoMap[key] !== undefined) el.textContent = (demoMap[key] * 100).toFixed(1) + '%';
        };
        setPct('demo-lfpr',     'Labor Force Participation Rate and Size (civilian population 16 years and over)');
        setPct('demo-primeage', 'Prime-Age Labor Force Participation Rate and Size (civilian population 25-54)');
        setPct('demo-wfh',      'Work from Home');

        renderBars('age-bars', [
            { label: 'Under 18', v: demoMap['Under 18 Years']      || 0 },
            { label: '18–24',    v: demoMap['18 to 24 Years']      || 0 },
            { label: '25–34',    v: demoMap['25 to 34 Years']      || 0 },
            { label: '35–44',    v: demoMap['35 to 44 Years']      || 0 },
            { label: '45–54',    v: demoMap['45 to 54 Years']      || 0 },
            { label: '55–64',    v: demoMap['55 to 64 Years']      || 0 },
            { label: '65–74',    v: demoMap['65 to 74 Years']      || 0 },
            { label: '75+',      v: demoMap['75 Years and Over']   || 0 },
        ], C.orange);

        const otherRace = (demoMap['Race: American Indian and Alaska Native'] || 0)
            + (demoMap['Race: Native Hawaiian and Other Pacific Islander'] || 0)
            + (demoMap['Race: Some Other Race'] || 0);

        renderBars('race-bars', [
            { label: 'Black / African Am.', v: demoMap['Race: Black or African American'] || 0 },
            { label: 'White',               v: demoMap['Race: White']                     || 0 },
            { label: 'Hispanic / Latino',   v: demoMap['Hispanic or Latino (of any race)'] || 0 },
            { label: 'Two or More Races',   v: demoMap['Race: Two or More Races']          || 0 },
            { label: 'Asian',               v: demoMap['Race: Asian']                      || 0 },
            { label: 'Other',               v: otherRace },
        ], C.accent);

        renderBars('edu-bars', [
            { label: 'Postgraduate', v: demoMap['Postgraduate Degree']       || 0 },
            { label: "Bachelor's",   v: demoMap["Bachelor's Degree"]         || 0 },
            { label: "Associate's",  v: demoMap["Associate's Degree"]        || 0 },
            { label: 'Some College', v: demoMap['Some College, No Degree']   || 0 },
            { label: 'High School',  v: demoMap['High School Graduate']      || 0 },
            { label: 'No Diploma',   v: demoMap['No High School Diploma']    || 0 },
        ], C.teal);
    }

    // ===== OCCUPATIONS TABLE =====
    // Same top-N + "Show All" pattern already used for the Hiring Demand
    // charts below (renderHiringChart/renderEmployersChart in charts.js) —
    // 15 rows is a lot of table for a first view, especially on mobile.
    let occAllRows = [];
    let occExpanded = false;

    function renderOccTable() {
        const rows = occExpanded ? occAllRows : occAllRows.slice(0, 5);
        const tbody = document.getElementById('occ-tbody');
        if (!tbody) return;
        tbody.innerHTML = rows.map((r, i) => {
            const wage = toNum(r['Mean Ann Wages2']);
            const wageStr = wage > 0 ? '$' + Math.round(wage).toLocaleString() : '—';
            return `<tr>
                <td class="occ-rank">${i + 1}</td>
                <td style="font-weight:500">${r['Occupation']}</td>
                <td>${Math.round(toNum(r['Empl'])).toLocaleString()}</td>
                <td>${wageStr}</td>
            </tr>`;
        }).join('');

        const btn = document.getElementById('occ-toggle');
        if (btn) btn.textContent = occExpanded ? '▲ Show Less' : '▼ Show All Occupations';
    }

    function renderOccupations(occRows) {
        occAllRows = occRows
            .filter(r => toNum(r['Empl']) > 0 && r['Occupation'] && r['SOC'] !== '00-0000')
            .sort((a, b) => toNum(b['Empl']) - toNum(a['Empl']))
            .slice(0, 15);
        renderOccTable();

        const btn = document.getElementById('occ-toggle');
        if (btn) {
            btn.addEventListener('click', () => {
                occExpanded = !occExpanded;
                renderOccTable();
            });
        }
    }

    // ===== OCCUPATION INTELLIGENCE GRID =====
    const SOC3_NAMES = {
        '11-1': 'Top Executives', '11-2': 'Advertising & Marketing Managers',
        '11-3': 'Operations Specialties Managers', '11-9': 'Other Managers',
        '13-1': 'Business Operations Specialists', '13-2': 'Financial Specialists',
        '15-1': 'Computer Occupations', '15-2': 'Mathematical Science Occupations',
        '17-1': 'Architects & Surveyors', '17-2': 'Engineers', '17-3': 'Engineering Technicians',
        '19-1': 'Life Scientists', '19-2': 'Physical Scientists', '19-3': 'Social Scientists',
        '19-4': 'Science Technicians', '19-5': 'Occupational Health & Safety',
        '21-1': 'Counselors & Social Workers', '21-2': 'Religious Workers',
        '23-1': 'Lawyers & Judges', '23-2': 'Legal Support Workers',
        '25-1': 'Postsecondary Teachers', '25-2': 'K-12 Teachers',
        '25-3': 'Other Teachers', '25-4': 'Librarians & Archivists', '25-9': 'Other Education',
        '27-1': 'Art & Design Workers', '27-2': 'Entertainers & Performers',
        '27-3': 'Media & Communications', '27-4': 'Media Equipment Workers',
        '29-1': 'Health Diagnosing & Treating', '29-2': 'Health Technologists',
        '29-9': 'Other Healthcare Practitioners',
        '31-1': 'Home Health & Personal Care Aides', '31-2': 'Therapy Assistants',
        '31-9': 'Other Healthcare Support',
        '33-1': 'Protective Service Supervisors', '33-2': 'Firefighting Workers',
        '33-3': 'Law Enforcement', '33-9': 'Other Protective Services',
        '35-1': 'Food Service Supervisors', '35-2': 'Cooks & Food Prep',
        '35-3': 'Food & Beverage Servers', '35-9': 'Other Food Service',
        '37-1': 'Grounds & Cleaning Supervisors', '37-2': 'Building Cleaning Workers',
        '37-3': 'Grounds Maintenance',
        '39-1': 'Personal Care Supervisors', '39-2': 'Animal Care Workers',
        '39-3': 'Entertainment Attendants', '39-5': 'Personal Appearance Workers',
        '39-9': 'Other Personal Care',
        '41-1': 'Sales Supervisors', '41-2': 'Retail Sales Workers',
        '41-3': 'Sales Reps, Services', '41-4': 'Sales Reps, Wholesale & Mfg',
        '41-9': 'Other Sales',
        '43-1': 'Admin Support Supervisors', '43-2': 'Communications Operators',
        '43-3': 'Financial Clerks', '43-4': 'Information & Record Clerks',
        '43-5': 'Material Recording & Dispatching', '43-6': 'Secretaries & Admin Assistants',
        '43-9': 'Other Office & Admin Support',
        '45-2': 'Agricultural Workers', '45-4': 'Forest & Logging Workers',
        '47-1': 'Construction Supervisors', '47-2': 'Construction Trades',
        '47-3': 'Construction Helpers', '47-4': 'Other Construction',
        '47-5': 'Extraction Workers',
        '49-1': 'Maintenance Supervisors', '49-2': 'Electrical & Electronic Repairers',
        '49-3': 'Vehicle Mechanics', '49-9': 'Other Maintenance & Repair',
        '51-1': 'Production Supervisors', '51-2': 'Assemblers & Fabricators',
        '51-3': 'Food Processing Workers', '51-4': 'Metal & Plastic Workers',
        '51-5': 'Printing Workers', '51-6': 'Textile & Apparel Workers',
        '51-8': 'Plant & System Operators', '51-9': 'Other Production',
        '53-1': 'Transportation Supervisors', '53-2': 'Air Transportation',
        '53-3': 'Motor Vehicle Operators', '53-4': 'Rail Transportation',
        '53-7': 'Material Moving Workers', '53-9': 'Other Transportation',
    };

    function buildSocGroups(rows, metric) {
        const groups = {};
        rows.forEach(r => {
            const code = r['SOC'].slice(0, 6);
            const empl = toNum(r['Empl']);
            if (!groups[code]) groups[code] = { empl: 0, wsum: 0, firstName: r['Occupation'] };
            groups[code].empl += empl;
            groups[code].wsum += empl * toNum(r[metric]);
        });
        return Object.entries(groups)
            .filter(([, g]) => g.empl >= 50)
            .map(([code, g]) => ({
                label: SOC3_NAMES[code] || g.firstName || code,
                v: g.empl ? g.wsum / g.empl : 0,
            }));
    }

    function renderOccupationIntelligence(occRows) {
        const fmtPct  = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
        const fmtNum  = v => Math.round(v).toLocaleString();
        const fmtWage = v => '$' + Math.round(v / 1000) + 'K';

        const base = occRows.filter(r => r['Occupation'] && r['SOC'] && r['SOC'].slice(-2) !== '00');
        const noTotal = r => !r['Occupation'].toLowerCase().includes('total');

        const projGroups = buildSocGroups(base, 'Ann % Growth');

        // Both default to 5 on mobile instead of the desktop 8 — same idea
        // as the Hiring Demand charts and the occupations table, just
        // applied here too. The "Show More" toggle (mobile-only — see the
        // #occ-growth-toggle/#occ-wage-toggle CSS) reveals the rest of the
        // desktop-equivalent 8, it doesn't need its own separate full list.
        const growthAllData = projGroups.filter(g => g.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
        const wageAllData = base.filter(r => toNum(r['Mean Ann Wages2']) > 0)
            .sort((a, b) => toNum(b['Mean Ann Wages2']) - toNum(a['Mean Ann Wages2'])).slice(0, 8)
            .map(r => ({ label: r['Occupation'], v: toNum(r['Mean Ann Wages2']) }));

        let growthExpanded = false;
        let wageExpanded = false;

        function renderGrowth() {
            const count = growthExpanded || !isMobile() ? 8 : 5;
            renderBars('occ-proj-growth', growthAllData.slice(0, count), C.teal, fmtPct, 'mid-label');
            const btn = document.getElementById('occ-growth-toggle');
            if (btn) btn.textContent = growthExpanded ? '▲ Show Less' : '▼ Show More';
        }
        function renderWage() {
            const count = wageExpanded || !isMobile() ? 8 : 5;
            renderBars('occ-wage-mean', wageAllData.slice(0, count), C.orange, fmtWage, 'mid-label');
            const btn = document.getElementById('occ-wage-toggle');
            if (btn) btn.textContent = wageExpanded ? '▲ Show Less' : '▼ Show More';
        }

        renderGrowth();
        renderWage();

        const growthBtn = document.getElementById('occ-growth-toggle');
        if (growthBtn) growthBtn.addEventListener('click', () => { growthExpanded = !growthExpanded; renderGrowth(); });
        const wageBtn = document.getElementById('occ-wage-toggle');
        if (wageBtn) wageBtn.addEventListener('click', () => { wageExpanded = !wageExpanded; renderWage(); });

        window.addEventListener('resize', debounce(() => { renderGrowth(); renderWage(); }, 250));

        // Job Exits / Occupational Transfers / Net New Positions share one
        // full-width chart behind a tab switcher instead of three stacked
        // cards — same information, a fraction of the vertical space, and
        // the full-width column gives labels room to not truncate as hard.
        const DEMAND_METRICS = {
            exits: {
                sub: 'Workers permanently leaving the occupation annually', color: C.orange,
                data: base.filter(noTotal).filter(r => toNum(r['Exits']) > 0)
                    .sort((a, b) => toNum(b['Exits']) - toNum(a['Exits'])).slice(0, 5)
                    .map(r => ({ label: r['Occupation'], v: toNum(r['Exits']) })),
            },
            transfers: {
                sub: 'Workers moving into a different occupation annually', color: C.accent,
                data: base.filter(noTotal).filter(r => toNum(r['Transfers']) > 0)
                    .sort((a, b) => toNum(b['Transfers']) - toNum(a['Transfers'])).slice(0, 5)
                    .map(r => ({ label: r['Occupation'], v: toNum(r['Transfers']) })),
            },
            netgrowth: {
                sub: 'Projected net employment growth (absolute jobs added)', color: C.teal,
                data: base.filter(noTotal).filter(r => toNum(r['Empl Growth']) > 0)
                    .sort((a, b) => toNum(b['Empl Growth']) - toNum(a['Empl Growth'])).slice(0, 5)
                    .map(r => ({ label: r['Occupation'], v: toNum(r['Empl Growth']) })),
            },
        };

        const tabs  = document.querySelectorAll('.occ-tab');
        const subEl = document.getElementById('occ-demand-sub');

        function renderDemand(metric) {
            const m = DEMAND_METRICS[metric];
            if (!m) return;
            if (subEl) subEl.textContent = m.sub;
            renderBars('occ-demand-chart', m.data, m.color, fmtNum, 'wide-label');
            tabs.forEach(t => {
                const active = t.dataset.metric === metric;
                t.classList.toggle('active', active);
                t.setAttribute('aria-selected', String(active));
            });
        }

        tabs.forEach(t => t.addEventListener('click', () => renderDemand(t.dataset.metric)));
        renderDemand('exits');
    }

    // ===== REGIONAL MAP =====
    // Persists across buildMap re-renders (called again on every resize,
    // which fully rebuilds the SVG from scratch) so toggling this and then
    // rotating a device or resizing the window doesn't silently reset back
    // to the county-labels view.
    let showHighways = false;

    function buildMap(commRows, popRows, geo, highwaysGeo) {
        const container = document.getElementById('region-map');
        if (!container) return;
        container.innerHTML = '';

        const commLookup = {}, popLookup = {}, nameLookup = {};
        commRows.forEach(d => {
            const fips = fips5(d.FIPS);
            commLookup[fips] = toNum(d.NetCommuting);
            nameLookup[fips] = (d.Region || '').replace(', Georgia', '').replace(' County', '');
        });
        popRows.forEach(d => {
            popLookup[fips5(d.FIPS)] = toNum(d.Population);
        });

        const W = container.clientWidth  || 900;
        const H = container.clientHeight || 616;

        const nonBibb = Object.entries(commLookup).filter(([f]) => f !== BIBB);
        const maxPos  = Math.max(0, ...nonBibb.filter(([, v]) => v >  0).map(([, v]) =>  v));
        const maxNeg  = Math.max(0, ...nonBibb.filter(([, v]) => v <= 0).map(([, v]) => -v));

        const countyFill = fips => {
            if (fips === BIBB) return C.maconGreen;
            if (fips === WILKINSON) return C.lightestGreen;
            const comm = commLookup[fips] || 0;
            if (comm > 0) {
                const t = comm / (maxPos || 1);
                return d3.interpolateRgb('#123a35', C.teal)(0.2 + t * 0.8);
            }
            const t = -comm / (maxNeg || 1);
            return d3.interpolateRgb('#3a2411', C.orange)(0.2 + t * 0.8);
        };

        const projection = d3.geoAlbers().fitExtent([[24, 24], [W - 24, H - 24]], geo);
        const pathGen     = d3.geoPath().projection(projection);

        const svg = d3.select(container)
            .append('svg')
            .attr('width', W).attr('height', H)
            .style('font-family', 'var(--font-body)');

        svg.append('rect').attr('width', W).attr('height', H).attr('fill', C.bgSurfaceDeep);

        svg.append('g').selectAll('path')
            .data(geo.features)
            .join('path')
            .attr('d', pathGen)
            .attr('fill', d => countyFill(fips5(d.id)))
            .attr('stroke', C.border)
            .attr('stroke-width', 1);

        const bibbFeature = geo.features.find(d => fips5(d.id) === BIBB);
        if (bibbFeature) {
            svg.append('path')
                .datum(bibbFeature)
                .attr('d', pathGen)
                .attr('fill', 'none')
                .attr('stroke', C.maconGreenLight)
                .attr('stroke-width', 2);
        }

        // Major highways — hidden by default, revealed by clicking the map
        // (see the click handler below). Drawn with the same pathGen/
        // projection as the counties, so a real GeoJSON of I-75/I-16/I-475/
        // US-19 lines up correctly against the county boundaries with no
        // separate alignment work needed. The source file has a small
        // margin beyond the 17-county extent (so lines don't look
        // artificially truncated right at the fitted edge) — clipped here
        // to the actual union of the county shapes, so nothing renders out
        // in the blank background beyond the counties actually shown.
        const clipId = 'counties-clip';
        svg.append('defs').append('clipPath').attr('id', clipId)
            .selectAll('path')
            .data(geo.features)
            .join('path')
            .attr('d', pathGen);

        const highwaysG = svg.append('g')
            .attr('class', 'map-highways')
            .attr('clip-path', `url(#${clipId})`)
            .style('opacity', 0)
            .style('pointer-events', 'none');
        // Labels live in their own sibling group, NOT inside the clipped
        // one — a route's line correctly stops right at the county edge,
        // but a label badge anchored near that same edge was getting its
        // own corner sliced off by the identical clip-path, since clip-path
        // applies to every descendant. A label should stay fully readable
        // even when it sits close to the boundary; only the raw line needs
        // to visually stop there.
        const highwayLabelsG = svg.append('g')
            .attr('class', 'map-highway-labels')
            .style('opacity', 0)
            .style('pointer-events', 'none');
        if (highwaysGeo && highwaysGeo.features.length) {
            // Three tiers, pushed further apart than before so interstates
            // read as clearly primary at a glance — thick, fully bright,
            // and their own accent-colored "shield" label — rather than
            // just a slightly-bolder version of the same white line/badge
            // every other road uses. Drawn state-then-US-then-interstate so
            // interstates paint on top at intersections.
            const TIER = {
                interstate: { order: 2, width: 3,   opacity: 1,    badge: C.teal,   text: '#0a2622' },
                us:         { order: 1, width: 1.4, opacity: 0.65, badge: '#1a1a1a', text: '#ffffff' },
                state:      { order: 0, width: 0.75,opacity: 0.4,  badge: '#1a1a1a', text: '#ffffff' },
            };
            const roadsSorted = [...highwaysGeo.features].sort((a, b) => TIER[a.properties.class].order - TIER[b.properties.class].order);

            highwaysG.selectAll('path')
                .data(roadsSorted)
                .join('path')
                .attr('d', pathGen)
                .attr('fill', 'none')
                .attr('stroke', '#ffffff')
                .attr('stroke-width', d => TIER[d.properties.class].width)
                .attr('stroke-opacity', d => TIER[d.properties.class].opacity)
                .attr('stroke-linecap', 'round')
                .attr('stroke-linejoin', 'round');

            // Anchor each label to one of the route's own points that's
            // actually inside a county, using real point-in-polygon tests
            // (d3.geoContains) in geographic space, and drop the label
            // entirely if the route never truly enters the displayed
            // region. Every route (not every line segment — a single
            // highway is chopped into many ways in the source data, all
            // sharing one route name) gets exactly one label, built from
            // every segment's points pooled together, or a dense road
            // network would carry a duplicate badge at every segment
            // boundary.
            function insidePoints(feature) {
                const coords = feature.geometry.type === 'LineString'
                    ? feature.geometry.coordinates
                    : feature.geometry.coordinates.flat();
                return coords.filter(pt => geo.features.some(c => d3.geoContains(c, pt)));
            }

            const byRoute = d3.group(highwaysGeo.features.filter(f => f.properties.route), f => f.properties.route);
            const labeled = Array.from(byRoute, ([route, feats]) => {
                const pts = feats.flatMap(insidePoints);
                if (!pts.length) return null;
                return { route, cls: feats[0].properties.class, pt: projection(pts[Math.floor(pts.length / 2)]) };
            }).filter(Boolean)
              // Interstates draw last (on top) so a state/US badge never
              // covers the handful of routes this map is meant to emphasize.
              .sort((a, b) => TIER[a.cls].order - TIER[b.cls].order);

            // Two different routes' "somewhere inside a county" midpoints
            // can land close together (I-75 and US-23 both pick a point
            // near where they cross, right by Bibb) and their badges
            // overlap. Push pairs apart until they clear a minimum
            // distance, a few passes since separating one pair can nudge
            // a label into a new collision with a third. An interstate
            // label never moves for a non-interstate collision — it's the
            // one this map is meant to emphasize, so it keeps its position
            // and the lower-priority label gets pushed clear of it instead.
            const MIN_LABEL_DIST = 48;
            for (let pass = 0; pass < 4; pass++) {
                for (let i = 0; i < labeled.length; i++) {
                    for (let j = i + 1; j < labeled.length; j++) {
                        const a = labeled[i], b = labeled[j];
                        const dx = b.pt[0] - a.pt[0], dy = b.pt[1] - a.pt[1];
                        const dist = Math.hypot(dx, dy) || 0.001;
                        if (dist >= MIN_LABEL_DIST) continue;
                        const need = MIN_LABEL_DIST - dist;
                        const ux = dx / dist, uy = dy / dist;
                        const aPinned = a.cls === 'interstate' && b.cls !== 'interstate';
                        const bPinned = b.cls === 'interstate' && a.cls !== 'interstate';
                        if (aPinned) {
                            b.pt = [b.pt[0] + ux * need, b.pt[1] + uy * need];
                        } else if (bPinned) {
                            a.pt = [a.pt[0] - ux * need, a.pt[1] - uy * need];
                        } else {
                            a.pt = [a.pt[0] - ux * need / 2, a.pt[1] - uy * need / 2];
                            b.pt = [b.pt[0] + ux * need / 2, b.pt[1] + uy * need / 2];
                        }
                    }
                }
            }

            const routeG = highwayLabelsG.selectAll('g.route-label')
                .data(labeled)
                .join('g')
                .attr('class', d => `route-label route-label--${d.cls}`)
                .attr('transform', d => `translate(${d.pt})`);
            const isInterstate = d => d.cls === 'interstate';
            routeG.append('rect')
                .attr('x', d => (isInterstate(d) ? 4 : 0) + (d.route.length > 4 ? -22 : -18))
                .attr('y', d => isInterstate(d) ? -10.5 : -9)
                .attr('width', d => (d.route.length > 4 ? 44 : 36) + (isInterstate(d) ? 8 : 0))
                .attr('height', d => isInterstate(d) ? 18 : 15)
                .attr('rx', 3)
                .attr('fill', d => TIER[d.cls].badge)
                .attr('stroke', d => isInterstate(d) ? 'none' : '#ffffff')
                .attr('stroke-opacity', d => TIER[d.cls].opacity)
                .attr('stroke-width', 1);
            routeG.append('text')
                .text(d => d.route)
                .attr('text-anchor', 'middle').attr('dy', 3.5)
                .attr('font-size', d => isInterstate(d) ? 10.5 : 9)
                .attr('font-weight', 700)
                .attr('fill', d => TIER[d.cls].text)
                .attr('fill-opacity', d => isInterstate(d) ? 1 : TIER[d.cls].opacity);
        }

        const labelG = svg.append('g').attr('pointer-events', 'none');
        geo.features.forEach(d => {
            const fips   = fips5(d.id);
            const isBibb = fips === BIBB;
            const [cx, cy] = pathGen.centroid(d);
            if (isNaN(cx) || isNaN(cy)) return;

            const name    = nameLookup[fips] || '';
            const pop     = popLookup[fips]  || 0;
            const comm    = commLookup[fips] || 0;
            const popStr  = pop >= 1000 ? (pop / 1000).toFixed(pop < 10000 ? 1 : 0) + 'K' : String(pop);
            const commStr = isBibb
                ? `+${Math.round(comm).toLocaleString()} net`
                : `net: ${Math.round(comm).toLocaleString()}`;

            // Wilkinson's fill is near-white, so the usual white text +
            // dark shadow (built for the mid/dark fills every other county
            // uses) would be unreadable — flip to dark text with no shadow.
            const isWilkinson = fips === WILKINSON;
            const g = labelG.append('g')
                .attr('class', isBibb ? 'county-label county-label--bibb' : 'county-label')
                .attr('transform', `translate(${cx},${cy})`)
                .style('text-shadow', isWilkinson ? 'none' : '1px 1px 2px rgba(0,0,0,0.85)');

            if (isBibb) {
                g.append('text').text('Macon-Bibb')
                    .attr('text-anchor', 'middle').attr('dy', '-10')
                    .attr('font-size', 13).attr('font-weight', 700).attr('fill', '#ffffff');
                g.append('text').text(popStr)
                    .attr('text-anchor', 'middle').attr('dy', '5')
                    .attr('font-size', 11).attr('fill', C.maconGreenLight);
                g.append('text').text(commStr)
                    .attr('text-anchor', 'middle').attr('dy', '19')
                    .attr('font-size', 9.5).attr('fill', '#bbf7d0');
            } else {
                const bounds = pathGen.bounds(d);
                const minDim = Math.min(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1]);
                if (minDim < 24) return;

                const fs = Math.max(7, Math.min(10, minDim / 6));
                g.append('text').text(name)
                    .attr('text-anchor', 'middle').attr('dy', minDim < 42 ? '-2' : '-5')
                    .attr('font-size', fs).attr('font-weight', 600).attr('fill', isWilkinson ? '#1a3a26' : '#ffffff');
                g.append('text').text(popStr)
                    .attr('text-anchor', 'middle').attr('dy', '8')
                    .attr('font-size', fs - 1).attr('fill', isWilkinson ? '#3d5b4a' : '#d8d8d8');
                if (minDim >= 42) {
                    const commColor = isWilkinson ? C.maconGreen : (comm > 0 ? '#bbf7d0' : '#fed7aa');
                    g.append('text').text(commStr)
                        .attr('text-anchor', 'middle').attr('dy', '20')
                        .attr('font-size', fs - 1).attr('fill', commColor);
                }
            }
        });

        // Hover tooltip
        const tip = document.createElement('div');
        tip.className = 'map-county-tip';
        container.appendChild(tip);

        svg.selectAll('path')
            .on('mousemove', function (evt, d) {
                const fips   = fips5(d.id);
                const isBibb = fips === BIBB;
                const name   = nameLookup[fips] || 'Unknown';
                const pop    = (popLookup[fips] || 0).toLocaleString();
                const comm   = commLookup[fips] || 0;
                const commColor = isBibb ? C.maconGreen : (fips === WILKINSON ? C.maconGreenLight : (comm > 0 ? C.teal : C.orange));
                const commLine  = `Net commuting balance: <strong style="color:${commColor}">${comm > 0 ? '+' : ''}${Math.round(comm).toLocaleString()}</strong>`;
                tip.innerHTML = `<strong style="display:block;margin-bottom:3px">${name} County</strong>Population: <strong>${pop}</strong><br>${commLine}`;
                const rect = container.getBoundingClientRect();
                tip.style.left = (evt.clientX - rect.left + 14) + 'px';
                tip.style.top  = (evt.clientY - rect.top  - 10) + 'px';
                tip.style.display = 'block';
            })
            .on('mouseleave', () => { tip.style.display = 'none'; });

        // Click the map to swap every county's name/population/commuting
        // labels (Macon-Bibb included) for the region's major highways —
        // same underlying projection, so the overlay lines up exactly with
        // the county shapes without any separate alignment step.
        function applyHighwayMode(animate) {
            (animate ? highwaysG.transition().duration(300) : highwaysG).style('opacity', showHighways ? 1 : 0);
            (animate ? highwayLabelsG.transition().duration(300) : highwayLabelsG).style('opacity', showHighways ? 1 : 0);
            const labels = svg.selectAll('.county-label');
            (animate ? labels.transition().duration(300) : labels).style('opacity', showHighways ? 0 : 1);
        }
        applyHighwayMode(false);

        svg.style('cursor', 'pointer')
            .on('click', () => {
                showHighways = !showHighways;
                applyHighwayMode(true);
            });

        // First-visit hint that the map itself is clickable — the section
        // description mentions it too, but that's one clause in a longer
        // paragraph and easy to skim past; this is the actually-noticeable
        // version. Gone for good, this browser, the moment the map is
        // clicked once — never shows again even on a later visit.
        const HINT_KEY = 'mwn-highway-hint-dismissed';
        let hintEl = null;
        try {
            if (!localStorage.getItem(HINT_KEY)) {
                hintEl = document.createElement('div');
                hintEl.className = 'map-highway-hint';
                hintEl.innerHTML = '<span class="map-highway-hint-dot"></span>Click the map for highways';
                container.appendChild(hintEl);
            }
        } catch (e) { /* localStorage unavailable (private browsing etc.) — hint just won't persist dismissal */ }

        svg.on('click.hint', () => {
            if (hintEl) { hintEl.remove(); hintEl = null; }
            try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
        });

        // Population stats box (SVG, included in PNG export)
        const totalPop = Object.values(popLookup).reduce((s, v) => s + v, 0);
        const bibbPop  = popLookup[BIBB] || 0;
        const fmt = n => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : (n / 1_000).toFixed(0) + 'K';

        // Below this width, sitting side by side (bottom-left stats box,
        // bottom-right legend) leaves almost no map visible between them —
        // together they span nearly the full width and blanket whichever
        // southern counties happen to fall behind them. Stacking both in
        // the bottom-left instead (see legX/legY below) frees the entire
        // right side of the map.
        const isNarrowMap = W < 420;
        const statsW = 148, statsH = 80, statsX = 12, statsY = H - statsH - 12;
        const statsG = svg.append('g').attr('transform', `translate(${statsX},${statsY})`);
        statsG.append('rect')
            .attr('width', statsW).attr('height', statsH).attr('rx', 6)
            .attr('fill', C.bgSurface).attr('stroke', C.border).attr('stroke-width', 1);
        statsG.append('text').text(fmt(totalPop))
            .attr('x', 12).attr('y', 26)
            .attr('font-size', 19).attr('font-weight', 700).attr('fill', '#ffffff').attr('letter-spacing', '-0.03em');
        statsG.append('text').text('TOTAL REGIONAL POPULATION')
            .attr('x', 12).attr('y', 38)
            .attr('font-size', 7).attr('font-weight', 600).attr('fill', C.textMuted).attr('letter-spacing', '0.05em');
        statsG.append('line')
            .attr('x1', 12).attr('y1', 46).attr('x2', statsW - 12).attr('y2', 46)
            .attr('stroke', C.border).attr('stroke-width', 1);
        statsG.append('text').text(fmt(bibbPop))
            .attr('x', 12).attr('y', 63)
            .attr('font-size', 19).attr('font-weight', 700).attr('fill', C.maconGreen).attr('letter-spacing', '-0.03em');
        statsG.append('text').text('MACON-BIBB POPULATION')
            .attr('x', 12).attr('y', 75)
            .attr('font-size', 7).attr('font-weight', 600).attr('fill', C.textMuted).attr('letter-spacing', '0.05em');

        // Legend box (SVG, included in PNG export)
        const LEG_ITEMS = [
            { color: C.maconGreen, stroke: C.maconGreenLight, label: 'Macon-Bibb County' },
            { color: C.orange, label: 'Negative net commuting' },
            { color: C.lightestGreen, stroke: C.maconGreen, label: 'Positive net commuting' },
        ];
        const legW = 158, legH = 14 + LEG_ITEMS.length * 18 + 8;
        // Narrow map: stack directly above the stats box instead of
        // sitting bottom-right — same X so the two read as one column.
        const legX = isNarrowMap ? statsX : W - legW - 12;
        const legY = isNarrowMap ? statsY - legH - 8 : H - legH - 12;
        const legG = svg.append('g').attr('transform', `translate(${legX},${legY})`);
        legG.append('rect')
            .attr('width', legW).attr('height', legH).attr('rx', 6)
            .attr('fill', C.bgSurface).attr('stroke', C.border).attr('stroke-width', 1);
        legG.append('text').text('MAP KEY')
            .attr('x', 10).attr('y', 14)
            .attr('font-size', 8).attr('font-weight', 700).attr('fill', '#ffffff').attr('letter-spacing', '0.06em');
        LEG_ITEMS.forEach((item, i) => {
            const iy = 22 + i * 18;
            legG.append('rect')
                .attr('x', 10).attr('y', iy).attr('width', 11).attr('height', 11).attr('rx', 2)
                .attr('fill', item.color)
                .attr('stroke', item.stroke || 'none').attr('stroke-width', item.stroke ? 1 : 0);
            legG.append('text').text(item.label)
                .attr('x', 26).attr('y', iy + 8.5)
                .attr('font-size', 9.5).attr('fill', C.textSec);
        });

        // PNG download button
        const dlBtn = document.createElement('button');
        dlBtn.className = 'map-dl-btn';
        dlBtn.textContent = '↓ PNG';
        dlBtn.title = 'Download map as PNG';
        dlBtn.addEventListener('click', () => {
            const svgEl  = container.querySelector('svg');
            const svgStr = new XMLSerializer().serializeToString(svgEl);
            const SCALE  = 2;
            const canvas = document.createElement('canvas');
            canvas.width  = W * SCALE;
            canvas.height = H * SCALE;
            const ctx = canvas.getContext('2d');
            ctx.scale(SCALE, SCALE);
            const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
            const url  = URL.createObjectURL(blob);
            const img  = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                const a = document.createElement('a');
                a.download = 'macon-regional-map.png';
                a.href = canvas.toDataURL('image/png');
                a.click();
            };
            img.src = url;
        });
        container.appendChild(dlBtn);
    }

    // ===== INIT =====
    let cachedCommRows, cachedPopRows, cachedGeo, cachedHighwaysGeo;

    Promise.all([
        d3.csv('data/Industry Snapshot.csv'),
        d3.csv('data/Occupation Snapshot.csv'),
        d3.csv('data/Population By County.csv'),
        d3.csv('data/Net Commuting.csv'),
        d3.csv('data/Demographics.csv'),
        d3.json('data/counties.geojson'),
        d3.json('data/major-highways.geojson'),
    ]).then(([indRows, occRows, popRows, commRows, demoRows, geo, highwaysGeo]) => {
        const dataRows = indRows.filter(r => (r['NAICS'] || '').trim() !== '');
        const totalRow = indRows.find(r => !(r['NAICS'] || '').trim());

        cachedCommRows    = commRows;
        cachedPopRows     = popRows;
        cachedGeo         = geo;
        cachedHighwaysGeo = highwaysGeo;

        loadKPIs(dataRows, totalRow, popRows, commRows);
        buildMap(commRows, popRows, geo, highwaysGeo);

        hierarchy = buildHierarchy(dataRows);
        renderTreemap(hierarchy);

        renderDemographics(demoRows, popRows);
        renderOccupations(occRows);
        renderOccupationIntelligence(occRows);
    }).catch(err => {
        console.error('Workforce data load error:', err);
    });

    window.addEventListener('resize', debounce(function () {
        if (currentNode) renderTreemap(currentNode);
        if (cachedGeo) buildMap(cachedCommRows, cachedPopRows, cachedGeo, cachedHighwaysGeo);
    }, 250));

})();

/* ===== INFO POPOVERS (chart data/source explanations) ===== */
(function () {
    const buttons = document.querySelectorAll('.info-btn');
    if (!buttons.length) return;

    function closeAll() {
        document.querySelectorAll('.info-popover.open').forEach(p => p.classList.remove('open'));
        document.querySelectorAll('.info-btn.active').forEach(b => b.classList.remove('active'));
    }

    buttons.forEach(btn => {
        const popover = btn.nextElementSibling;
        if (!popover) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = popover.classList.contains('open');
            closeAll();
            if (!wasOpen) {
                popover.classList.add('open');
                btn.classList.add('active');
            }
        });
    });

    document.addEventListener('click', closeAll);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
})();

/* ===== ADJUSTED PICTURE — supporting context toggle ===== */
(function () {
    const btn = document.getElementById('adj-context-toggle');
    const box = document.getElementById('adj-context');
    if (!btn || !box) return;
    btn.addEventListener('click', () => {
        const open = box.classList.toggle('open');
        btn.textContent = open ? '▲ Hide Supporting Context' : '▼ Show Supporting Context';
    });
})();

/* ===== IN-PAGE JUMP NAV — active section highlight ===== */
(function () {
    const links = Array.from(document.querySelectorAll('.page-jumpnav a'));
    if (!links.length) return;

    const sections = links
        .map(a => document.getElementById(a.getAttribute('href').slice(1)))
        .filter(Boolean);

    const nav = document.querySelector('.page-jumpnav');

    const setActive = (id) => {
        let activeLink = null;
        links.forEach(a => {
            const isActive = a.getAttribute('href') === '#' + id;
            a.classList.toggle('active', isActive);
            if (isActive) activeLink = a;
        });
        // On mobile the nav itself scrolls horizontally (see the ≤768px CSS) —
        // keep the active pill in view as the highlight moves, same idea as
        // the carousel dots tracking their own scroll position. Scrolled via
        // the nav's own scrollLeft (not activeLink.scrollIntoView) because
        // the nav is position:sticky — scrollIntoView's "nearest" ancestor
        // resolution isn't reliable there and was fighting the page's own
        // anchor-jump scroll (jumping to a section could visibly bounce to
        // the wrong scroll position). Setting scrollLeft directly can only
        // ever move the nav's own horizontal scrollbar, never the page.
        if (activeLink && nav && window.innerWidth <= 768) {
            const navRect  = nav.getBoundingClientRect();
            const linkRect = activeLink.getBoundingClientRect();
            const delta = (linkRect.left + linkRect.width / 2) - (navRect.left + navRect.width / 2);
            nav.scrollTo({ left: nav.scrollLeft + delta, behavior: 'smooth' });
        }
    };

    const observer = new IntersectionObserver((entries) => {
        // Pick the entry closest to the top of the viewport among those
        // currently intersecting, so the highlight tracks scroll position
        // even when several tall sections are on screen at once.
        const visible = entries.filter(e => e.isIntersecting);
        if (!visible.length) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActive(visible[0].target.id);
    }, { rootMargin: '-140px 0px -70% 0px', threshold: 0 });

    sections.forEach(s => observer.observe(s));
})();

/* ===== MOBILE CAROUSELS (Fast Facts, Adjusted Picture, Demographics) =====
   The card grids stack full-width on mobile (see viz.css), which is a lot
   of vertical clutter for repeated-shape cards — swiped one at a time
   instead, with dot indicators showing position/count. Card markup itself
   is untouched; this only adds the dots and keeps them synced to scroll
   position, and only runs below the same breakpoint the CSS switches on. */
(function () {
    const MOBILE_BREAKPOINT = 768;
    const CAROUSELS = [
        { selector: '.stats-grid', itemSelector: '.kpi-block' },
        { selector: '.adj-metrics-grid', itemSelector: '.adj-card' },
        { selector: '.demo-grid', itemSelector: '.demo-card' },
    ];

    function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }

    let resizeTimer;
    function debounced(fn, ms) { clearTimeout(resizeTimer); resizeTimer = setTimeout(fn, ms); }

    function buildDots(container, items) {
        const dots = document.createElement('div');
        dots.className = 'carousel-dots';
        const dotEls = items.map((item, i) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
            dot.setAttribute('aria-label', `Go to card ${i + 1} of ${items.length}`);
            dot.addEventListener('click', () => {
                item.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            });
            dots.appendChild(dot);
            return dot;
        });
        container.insertAdjacentElement('afterend', dots);

        // Whichever card is most visible in the scroll container gets the
        // active dot — tracks both swipes and dot-click scrolls, since both
        // just move the container's scroll position. With two-up carousels
        // (Fast Facts) more than one card can cross the threshold in the
        // same batch; naively setting the dot per-entry as the loop went
        // let whichever entry happened to be processed last win, which was
        // usually the second (right-hand) card even at the very start of
        // the scroll. Taking the lowest index among everything currently
        // visible picks the leading card of the page instead, correct for
        // both one-up and two-up carousels.
        const io = new IntersectionObserver((entries) => {
            const visibleIdxs = entries
                .filter(e => e.isIntersecting)
                .map(e => items.indexOf(e.target))
                .filter(i => i !== -1);
            if (!visibleIdxs.length) return;
            const idx = Math.min(...visibleIdxs);
            dotEls.forEach((d, i) => d.classList.toggle('active', i === idx));
        }, { root: container, threshold: 0.6 });
        items.forEach(item => io.observe(item));
    }

    const ARROW_LEFT  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    const ARROW_RIGHT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

    // A precise, clickable alternative to swiping — mainly for a desktop
    // browser resized down to a mobile width, where there's a mouse but no
    // touch/swipe gesture available at all.
    function buildArrows(wrap, container) {
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'carousel-arrow carousel-arrow--prev';
        prev.setAttribute('aria-label', 'Scroll to previous card');
        prev.innerHTML = ARROW_LEFT;

        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'carousel-arrow carousel-arrow--next';
        next.setAttribute('aria-label', 'Scroll to next card');
        next.innerHTML = ARROW_RIGHT;

        wrap.appendChild(prev);
        wrap.appendChild(next);

        prev.addEventListener('click', () => container.scrollBy({ left: -container.clientWidth * 0.9, behavior: 'smooth' }));
        next.addEventListener('click', () => container.scrollBy({ left: container.clientWidth * 0.9, behavior: 'smooth' }));

        // The container's own left padding (see the ≤768px carousel CSS)
        // means a fresh, unscrolled carousel already sits at scrollLeft ≈
        // that padding value, not 0 — scroll-snap-align: start snaps the
        // first card's edge to the padding box, not the true edge of the
        // scroll range. A slack of ~24px (comfortably past that natural
        // resting point, well short of a real card-width scroll) is what
        // "at the start" actually means here, not a strict ≤4.
        const EDGE_SLACK = 24;
        function updateArrows() {
            const maxScroll = container.scrollWidth - container.clientWidth;
            prev.classList.toggle('is-hidden', container.scrollLeft <= EDGE_SLACK);
            next.classList.toggle('is-hidden', container.scrollLeft >= maxScroll - EDGE_SLACK);
        }
        container.addEventListener('scroll', updateArrows, { passive: true });
        updateArrows();
    }

    function init() {
        if (!isMobile()) return;
        CAROUSELS.forEach(({ selector, itemSelector }) => {
            const container = document.querySelector(selector);
            if (!container || container.dataset.carouselInit) return;
            const items = Array.from(container.querySelectorAll(itemSelector));
            if (items.length < 2) return;
            container.dataset.carouselInit = '1';

            const wrap = document.createElement('div');
            wrap.className = 'carousel-wrap';
            container.parentNode.insertBefore(wrap, container);
            wrap.appendChild(container);

            buildDots(container, items);
            buildArrows(wrap, container);
        });
    }

    init();
    window.addEventListener('resize', () => debounced(init, 250));
})();

/* ===== COLLAPSIBLE SECTIONS (mobile only) =====
   Every .section on this page follows the same label -> title -> desc ->
   content shape, so the content can be wrapped generically at runtime
   instead of hand-editing seven different HTML blocks. Default stays
   expanded (nothing hides on load, so chart width measurements taken at
   render time are unaffected) — this just gives mobile users an easy way
   to collapse a section closed after reading it. */
(function () {
    const MOBILE_BREAKPOINT = 768;
    function isMobile() { return window.innerWidth <= MOBILE_BREAKPOINT; }

    const CHEVRON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';

    function wireSection(section) {
        if (section.dataset.collapseInit) return;
        const desc  = section.querySelector(':scope > .section-desc');
        const title = section.querySelector(':scope > .section-title');
        if (!desc || !title) return;
        section.dataset.collapseInit = '1';

        const body = document.createElement('div');
        body.className = 'section-body';
        let sib = desc.nextElementSibling;
        while (sib) {
            const next = sib.nextElementSibling;
            body.appendChild(sib);
            sib = next;
        }
        desc.insertAdjacentElement('afterend', body);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'section-collapse-btn';
        btn.setAttribute('aria-expanded', 'true');
        btn.setAttribute('aria-label', 'Collapse section');
        btn.innerHTML = CHEVRON_SVG;
        title.appendChild(btn);

        btn.addEventListener('click', () => {
            const collapsed = body.classList.toggle('collapsed');
            btn.classList.toggle('is-collapsed', collapsed);
            btn.setAttribute('aria-expanded', String(!collapsed));
            btn.setAttribute('aria-label', collapsed ? 'Expand section' : 'Collapse section');
        });
    }

    function init() {
        if (!isMobile()) return;
        document.querySelectorAll('main .section').forEach(wireSection);
    }

    let resizeTimer;
    init();
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(init, 250);
    });
})();
