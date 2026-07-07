(function () {
    'use strict';

    // ===== THEME =====
    const C = {
        accent:      '#4a9eff',
        accentHover: '#3a8eef',
        bgSurface:   '#252525',
        textPrimary: '#ffffff',
        textSec:     '#cccccc',
        textMuted:   '#888888',
        border:      '#444444',
    };

    // ===== SHARED TOOLTIP =====
    const tooltip = d3.select('body')
        .append('div')
        .style('position',       'absolute')
        .style('background',     '#1a1a1a')
        .style('border',         '1px solid ' + C.border)
        .style('border-radius',  '6px')
        .style('padding',        '0.5rem 0.8rem')
        .style('color',          C.textPrimary)
        .style('font-size',      '0.82rem')
        .style('line-height',    '1.55')
        .style('pointer-events', 'none')
        .style('opacity',        0)
        .style('z-index',        9999);

    function showTip(event, html) {
        tooltip.style('opacity', 1).html(html);
        moveTip(event);
    }
    function moveTip(event) {
        tooltip
            .style('left', (event.pageX + 14) + 'px')
            .style('top',  (event.pageY - 40) + 'px');
    }
    function hideTip() { tooltip.style('opacity', 0); }

    // ===== HELPERS =====
    function parseNum(str) {
        return parseInt(String(str).replace(/,/g, ''), 10);
    }
    function truncate(str, n) {
        return str.length > n ? str.slice(0, n - 1) + '\u2026' : str;
    }
    function debounce(fn, ms) {
        let t;
        return function () { clearTimeout(t); t = setTimeout(fn, ms); };
    }
    function calcLabelMargin(totalW) {
        return Math.min(230, Math.max(100, Math.floor(totalW * 0.38)));
    }
    function calcLabelChars(margin) {
        return Math.floor((margin - 12) / 7);
    }

    // ===== SHARED — SHORT NAME LOOKUP =====
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

    // ===== CHART 1 — TOP HIRING INDUSTRIES (HORIZONTAL BAR) =====
    let hiringExpanded = false;
    let hiringAllData  = [];

    function drawHiringChart(rows) {
        const container = document.getElementById('hiring-chart');
        if (!container) return;
        container.innerHTML = '';

        const totalJobs   = rows.reduce((s, d) => s + d.jobs, 0);
        const BAR_H       = 28;
        const BAR_GAP     = 10;
        const totalW      = container.clientWidth || 860;
        const labelMargin = calcLabelMargin(totalW);
        const labelChars  = calcLabelChars(labelMargin);
        const margin      = { top: 16, right: 56, bottom: 24, left: labelMargin };
        const W           = totalW - margin.left - margin.right;
        const H         = rows.length * (BAR_H + BAR_GAP);

        const svg = d3.select(container)
            .append('svg')
            .attr('width',  totalW)
            .attr('height', H + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleLinear()
            .domain([0, d3.max(rows, d => d.jobs)])
            .nice()
            .range([0, W]);

        const y = d3.scaleBand()
            .domain(rows.map(d => d.industry))
            .range([0, H])
            .padding(0.25);

        // Vertical grid lines
        svg.append('g')
            .call(d3.axisTop(x).tickSize(-H).tickFormat(''))
            .call(g => g.select('.domain').remove())
            .call(g => g.selectAll('line')
                .attr('stroke', C.border)
                .attr('stroke-dasharray', '3,3'));

        // Bars
        svg.selectAll('.hbar')
            .data(rows)
            .join('rect')
            .attr('y',      d => y(d.industry))
            .attr('x',      0)
            .attr('height', y.bandwidth())
            .attr('width',  d => x(d.jobs))
            .attr('fill',   C.accent)
            .attr('rx',     3)
            .on('mouseover', function (event, d) {
                d3.select(this).attr('fill', C.accentHover);
                const pct = ((d.jobs / totalJobs) * 100).toFixed(1);
                showTip(event,
                    `<strong>${d.industry}</strong><br>` +
                    `Active Job Ads: ${d.jobs.toLocaleString()} (${pct}%)`
                );
            })
            .on('mousemove', moveTip)
            .on('mouseout',  function () {
                d3.select(this).attr('fill', C.accent);
                hideTip();
            });

        // Value labels at end of each bar
        svg.selectAll('.bar-label')
            .data(rows)
            .join('text')
            .attr('x', d => x(d.jobs) + 6)
            .attr('y', d => y(d.industry) + y.bandwidth() / 2)
            .attr('dy', '0.35em')
            .attr('fill', C.textMuted)
            .style('font-size', '0.72rem')
            .text(d => d.jobs);

        // Y axis (industry names, truncated to fit margin)
        svg.append('g')
            .call(d3.axisLeft(y).tickSize(0).tickFormat(d => truncate(SHORT_NAMES[d] || d, labelChars)))
            .call(g => g.select('.domain').remove())
            .call(g => g.selectAll('text')
                .attr('fill', C.textSec)
                .style('font-size', '0.78rem')
                .attr('dx', '-0.5em'));

        // X axis
        svg.append('g')
            .attr('transform', `translate(0,${H})`)
            .call(d3.axisBottom(x).ticks(5).tickFormat(d => d))
            .call(g => g.select('.domain').attr('stroke', C.border))
            .call(g => g.selectAll('line').attr('stroke', C.border))
            .call(g => g.selectAll('text')
                .attr('fill', C.textSec)
                .style('font-size', '0.72rem'));

        // X axis label
        svg.append('text')
            .attr('x', W / 2)
            .attr('y', H + margin.bottom - 2)
            .attr('text-anchor', 'middle')
            .attr('fill', C.textMuted)
            .style('font-size', '0.75rem')
            .text('Active Job Ads');
    }

    function renderHiringChart() {
        const rows = hiringExpanded ? hiringAllData : hiringAllData.slice(0, 10);
        drawHiringChart(rows);

        // Sync toggle button label
        const btn = document.getElementById('hiring-toggle');
        if (btn) btn.textContent = hiringExpanded ? '▲ Show Less' : '▼ Show All Industries';
    }

    function loadHiringChart() {
        d3.csv('data/Top Hiring Industries.csv').then(function (data) {
            hiringAllData = data
                .filter(d => d.Industry && d['Active Job Ads'])
                .map(d => ({ industry: d.Industry, jobs: parseNum(d['Active Job Ads']) }))
                .sort((a, b) => b.jobs - a.jobs);
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

    // ===== CHART 2 — TOP EMPLOYERS (HORIZONTAL BAR) =====
    let employersExpanded = false;
    let employersAllData  = [];

    function drawEmployersChart(rows) {
        const container = document.getElementById('employers-chart');
        if (!container) return;
        container.innerHTML = '';

        const totalJobs   = rows.reduce((s, d) => s + d.jobs, 0);
        const BAR_H       = 28;
        const BAR_GAP     = 10;
        const totalW      = container.clientWidth || 860;
        const labelMargin = calcLabelMargin(totalW);
        const labelChars  = calcLabelChars(labelMargin);
        const margin      = { top: 16, right: 56, bottom: 24, left: labelMargin };
        const W           = totalW - margin.left - margin.right;
        const H         = rows.length * (BAR_H + BAR_GAP);

        const svg = d3.select(container)
            .append('svg')
            .attr('width',  totalW)
            .attr('height', H + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleLinear()
            .domain([0, d3.max(rows, d => d.jobs)])
            .nice()
            .range([0, W]);

        const y = d3.scaleBand()
            .domain(rows.map(d => d.company))
            .range([0, H])
            .padding(0.25);

        // Vertical grid lines
        svg.append('g')
            .call(d3.axisTop(x).tickSize(-H).tickFormat(''))
            .call(g => g.select('.domain').remove())
            .call(g => g.selectAll('line')
                .attr('stroke', C.border)
                .attr('stroke-dasharray', '3,3'));

        // Bars
        svg.selectAll('.ebar')
            .data(rows)
            .join('rect')
            .attr('y',      d => y(d.company))
            .attr('x',      0)
            .attr('height', y.bandwidth())
            .attr('width',  d => x(d.jobs))
            .attr('fill',   C.accent)
            .attr('rx',     3)
            .on('mouseover', function (event, d) {
                d3.select(this).attr('fill', C.accentHover);
                showTip(event,
                    `<strong>${d.company}</strong><br>` +
                    `Active Job Ads: ${d.jobs.toLocaleString()}`
                );
            })
            .on('mousemove', moveTip)
            .on('mouseout',  function () {
                d3.select(this).attr('fill', C.accent);
                hideTip();
            });

        // Value labels at end of each bar
        svg.selectAll('.elabel')
            .data(rows)
            .join('text')
            .attr('x', d => x(d.jobs) + 6)
            .attr('y', d => y(d.company) + y.bandwidth() / 2)
            .attr('dy', '0.35em')
            .attr('fill', C.textMuted)
            .style('font-size', '0.72rem')
            .text(d => d.jobs);

        // Y axis (company names, truncated to fit margin)
        svg.append('g')
            .call(d3.axisLeft(y).tickSize(0).tickFormat(d => truncate(d, labelChars)))
            .call(g => g.select('.domain').remove())
            .call(g => g.selectAll('text')
                .attr('fill', C.textSec)
                .style('font-size', '0.78rem')
                .attr('dx', '-0.5em'));

        // X axis
        svg.append('g')
            .attr('transform', `translate(0,${H})`)
            .call(d3.axisBottom(x).ticks(5))
            .call(g => g.select('.domain').attr('stroke', C.border))
            .call(g => g.selectAll('line').attr('stroke', C.border))
            .call(g => g.selectAll('text')
                .attr('fill', C.textSec)
                .style('font-size', '0.72rem'));

        // X axis label
        svg.append('text')
            .attr('x', W / 2)
            .attr('y', H + margin.bottom - 2)
            .attr('text-anchor', 'middle')
            .attr('fill', C.textMuted)
            .style('font-size', '0.75rem')
            .text('Active Job Ads');
    }

    function renderEmployersChart() {
        const rows = employersExpanded ? employersAllData : employersAllData.slice(0, 10);
        drawEmployersChart(rows);

        const btn = document.getElementById('employers-toggle');
        if (btn) btn.textContent = employersExpanded ? '▲ Show Less' : '▼ Show All Employers';
    }

    function loadEmployersChart() {
        d3.csv('data/Bibb Top Employers.csv').then(function (data) {
            employersAllData = data
                .filter(d => d.Company && d['Active Jobs'])
                .map(d => ({ company: d.Company, jobs: parseNum(d['Active Jobs']) }))
                .sort((a, b) => b.jobs - a.jobs);
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

    // ===== LOAD & RESIZE =====
    loadHiringChart();
    loadEmployersChart();
    window.addEventListener('resize', debounce(function () {
        renderHiringChart();
        renderEmployersChart();
    }, 250));

})();
