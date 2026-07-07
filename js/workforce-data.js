(function () {
    'use strict';

    // ===== THEME =====
    const C = {
        accent:        '#4a9eff',
        accentHover:   '#3a8eef',
        teal:          '#2dd4bf',
        orange:        '#fb923c',
        green:         '#66bb6a',
        bgSurface:     '#2d2d2d',
        bgSurfaceDeep: '#252525',
        textPrimary:   '#ffffff',
        textSec:       '#cccccc',
        textMuted:     '#888888',
        border:        '#444444',
    };

    const BIBB = '13021';

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

    // ===== INDUSTRY CONFIG (2-digit NAICS prefix -> sector) =====
    const INDUSTRIES = {
        '11': { name: 'Agriculture, Forestry & Fishing',   prefixes: ['11'],           color: '#86efac' },
        '21': { name: 'Mining & Oil and Gas',               prefixes: ['21'],           color: '#fcd34d' },
        '22': { name: 'Utilities',                          prefixes: ['22'],           color: '#67e8f9' },
        '23': { name: 'Construction',                       prefixes: ['23'],           color: '#fdba74' },
        '31': { name: 'Manufacturing',                      prefixes: ['31', '32', '33'], color: '#93c5fd' },
        '42': { name: 'Wholesale Trade',                    prefixes: ['42'],           color: '#5eead4' },
        '44': { name: 'Retail Trade',                       prefixes: ['44', '45'],     color: '#f9a8d4' },
        '48': { name: 'Transportation & Warehousing',       prefixes: ['48', '49'],     color: '#fca5a5' },
        '51': { name: 'Information',                        prefixes: ['51'],           color: '#c4b5fd' },
        '52': { name: 'Finance & Insurance',                prefixes: ['52'],           color: '#7dd3fc' },
        '53': { name: 'Real Estate',                        prefixes: ['53'],           color: '#6ee7b7' },
        '54': { name: 'Professional & Technical Services',  prefixes: ['54'],           color: '#a5b4fc' },
        '55': { name: 'Management of Companies',            prefixes: ['55'],           color: '#94a3b8' },
        '56': { name: 'Administrative & Support',           prefixes: ['56'],           color: '#fde68a' },
        '61': { name: 'Educational Services',                prefixes: ['61'],           color: '#bef264' },
        '62': { name: 'Health Care & Social Assistance',    prefixes: ['62'],           color: '#34d399' },
        '71': { name: 'Arts & Entertainment',                prefixes: ['71'],           color: '#f9a8d4' },
        '72': { name: 'Accommodation & Food Services',      prefixes: ['72'],           color: '#fb923c' },
        '81': { name: 'Other Services',                      prefixes: ['81'],           color: '#a1a1aa' },
        '92': { name: 'Public Administration',                prefixes: ['92'],           color: '#818cf8' },
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
    function renderBars(containerId, items, color, formatVal) {
        const el = document.getElementById(containerId);
        if (!el || !items.length) { if (el) el.innerHTML = ''; return; }
        const max   = Math.max(...items.map(i => i.v));
        const trunc = s => s.length > 30 ? s.slice(0, 29) + '…' : s;
        el.innerHTML = items.map(({ label, v }) => `
            <div class="demo-bar-row">
                <div class="demo-bar-label" title="${label}">${trunc(String(label))}</div>
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
    function renderOccupations(occRows) {
        const validOcc = occRows
            .filter(r => toNum(r['Empl']) > 0 && r['Occupation'] && r['SOC'] !== '00-0000')
            .sort((a, b) => toNum(b['Empl']) - toNum(a['Empl']))
            .slice(0, 15);

        const tbody = document.getElementById('occ-tbody');
        if (!tbody) return;
        tbody.innerHTML = validOcc.map((r, i) => {
            const wage = toNum(r['Mean Ann Wages2']);
            const wageStr = wage > 0 ? '$' + Math.round(wage).toLocaleString() : '—';
            return `<tr>
                <td class="occ-rank">${i + 1}</td>
                <td style="font-weight:500">${r['Occupation']}</td>
                <td>${Math.round(toNum(r['Empl'])).toLocaleString()}</td>
                <td>${wageStr}</td>
            </tr>`;
        }).join('');
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

        renderBars('occ-proj-growth',
            projGroups.filter(g => g.v > 0).sort((a, b) => b.v - a.v).slice(0, 8),
            C.teal, fmtPct);

        renderBars('occ-wage-mean',
            base.filter(r => toNum(r['Mean Ann Wages2']) > 0)
                .sort((a, b) => toNum(b['Mean Ann Wages2']) - toNum(a['Mean Ann Wages2'])).slice(0, 8)
                .map(r => ({ label: r['Occupation'], v: toNum(r['Mean Ann Wages2']) })),
            C.orange, fmtWage);

        renderBars('occ-exits',
            base.filter(noTotal).filter(r => toNum(r['Exits']) > 0)
                .sort((a, b) => toNum(b['Exits']) - toNum(a['Exits'])).slice(0, 5)
                .map(r => ({ label: r['Occupation'], v: toNum(r['Exits']) })),
            C.orange, fmtNum);

        renderBars('occ-transfers',
            base.filter(noTotal).filter(r => toNum(r['Transfers']) > 0)
                .sort((a, b) => toNum(b['Transfers']) - toNum(a['Transfers'])).slice(0, 5)
                .map(r => ({ label: r['Occupation'], v: toNum(r['Transfers']) })),
            C.accent, fmtNum);

        renderBars('occ-net-growth',
            base.filter(noTotal).filter(r => toNum(r['Empl Growth']) > 0)
                .sort((a, b) => toNum(b['Empl Growth']) - toNum(a['Empl Growth'])).slice(0, 5)
                .map(r => ({ label: r['Occupation'], v: toNum(r['Empl Growth']) })),
            C.green, fmtNum);
    }

    // ===== REGIONAL MAP =====
    function buildMap(commRows, popRows, geo) {
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
            if (fips === BIBB) return C.accent;
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
                .attr('stroke', '#7ec1ff')
                .attr('stroke-width', 2);
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

            const g = labelG.append('g')
                .attr('transform', `translate(${cx},${cy})`)
                .style('text-shadow', '1px 1px 2px rgba(0,0,0,0.85)');

            if (isBibb) {
                g.append('text').text('Macon-Bibb')
                    .attr('text-anchor', 'middle').attr('dy', '-10')
                    .attr('font-size', 13).attr('font-weight', 700).attr('fill', '#ffffff');
                g.append('text').text(popStr)
                    .attr('text-anchor', 'middle').attr('dy', '5')
                    .attr('font-size', 11).attr('fill', '#e8f3ff');
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
                    .attr('font-size', fs).attr('font-weight', 600).attr('fill', '#ffffff');
                g.append('text').text(popStr)
                    .attr('text-anchor', 'middle').attr('dy', '8')
                    .attr('font-size', fs - 1).attr('fill', '#d8d8d8');
                if (minDim >= 42) {
                    const commColor = comm > 0 ? '#bbf7d0' : '#fed7aa';
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
                const commColor = isBibb ? C.accent : (comm > 0 ? C.teal : C.orange);
                const commLine  = `Net commuting balance: <strong style="color:${commColor}">${comm > 0 ? '+' : ''}${Math.round(comm).toLocaleString()}</strong>`;
                tip.innerHTML = `<strong style="display:block;margin-bottom:3px">${name} County</strong>Population: <strong>${pop}</strong><br>${commLine}`;
                const rect = container.getBoundingClientRect();
                tip.style.left = (evt.clientX - rect.left + 14) + 'px';
                tip.style.top  = (evt.clientY - rect.top  - 10) + 'px';
                tip.style.display = 'block';
            })
            .on('mouseleave', () => { tip.style.display = 'none'; });

        // Population stats box (SVG, included in PNG export)
        const totalPop = Object.values(popLookup).reduce((s, v) => s + v, 0);
        const bibbPop  = popLookup[BIBB] || 0;
        const fmt = n => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : (n / 1_000).toFixed(0) + 'K';

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
            .attr('font-size', 19).attr('font-weight', 700).attr('fill', C.accent).attr('letter-spacing', '-0.03em');
        statsG.append('text').text('MACON-BIBB POPULATION')
            .attr('x', 12).attr('y', 75)
            .attr('font-size', 7).attr('font-weight', 600).attr('fill', C.textMuted).attr('letter-spacing', '0.05em');

        // Legend box (SVG, included in PNG export)
        const LEG_ITEMS = [
            { color: C.accent, stroke: '#7ec1ff', label: 'Macon-Bibb County' },
            { color: C.orange, label: 'Negative net commuting' },
            { color: C.teal,   label: 'Positive net commuting' },
        ];
        const legW = 158, legH = 14 + LEG_ITEMS.length * 18 + 8;
        const legX = W - legW - 12, legY = H - legH - 12;
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
    let cachedCommRows, cachedPopRows, cachedGeo;

    Promise.all([
        d3.csv('data/Industry Snapshot.csv'),
        d3.csv('data/Occupation Snapshot.csv'),
        d3.csv('data/Population By County.csv'),
        d3.csv('data/Net Commuting.csv'),
        d3.csv('data/Demographics.csv'),
        d3.json('data/counties.geojson'),
    ]).then(([indRows, occRows, popRows, commRows, demoRows, geo]) => {
        const dataRows = indRows.filter(r => (r['NAICS'] || '').trim() !== '');
        const totalRow = indRows.find(r => !(r['NAICS'] || '').trim());

        cachedCommRows = commRows;
        cachedPopRows  = popRows;
        cachedGeo      = geo;

        loadKPIs(dataRows, totalRow, popRows, commRows);
        buildMap(commRows, popRows, geo);

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
        if (cachedGeo) buildMap(cachedCommRows, cachedPopRows, cachedGeo);
    }, 250));

})();
