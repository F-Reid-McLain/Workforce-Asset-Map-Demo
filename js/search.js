/* ===== SEARCH — directory list filter + map highlight/jump-to ===== */

/* ----- Directory page ----- */
(function () {
    const input = document.getElementById('directory-search-input');
    if (!input) return;

    const clearBtn = document.getElementById('directory-search-clear');
    const emptyMsg = document.getElementById('directory-empty');
    const groups   = Array.from(document.querySelectorAll('.directory-group'));

    function applyFilter() {
        const q = input.value.trim().toLowerCase();
        let anyGroupVisible = false;

        groups.forEach(group => {
            const heading = group.querySelector('h3');
            const headingMatches = !q || (heading && heading.textContent.toLowerCase().includes(q));
            let groupHasMatch = headingMatches;

            group.querySelectorAll('.asset-link').forEach(link => {
                const matches = headingMatches || link.textContent.toLowerCase().includes(q);
                link.closest('li').hidden = !matches;
                if (matches) groupHasMatch = true;
            });

            group.hidden = !groupHasMatch;
            if (groupHasMatch) anyGroupVisible = true;
        });

        if (emptyMsg) emptyMsg.hidden = anyGroupVisible;
    }

    input.addEventListener('input', applyFilter);

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            input.value = '';
            applyFilter();
            input.focus();
        });
    }
})();

/* ----- Map page ----- */
(function () {
    const input = document.getElementById('map-search-input');
    if (!input) return;

    const clearBtn    = document.getElementById('map-search-clear');
    const resultsList = document.getElementById('viz-search-results');
    const searchBox    = document.getElementById('viz-search');
    const container    = document.getElementById('network-visualization');

    const DIM_OPACITY      = 0.12;
    const HIGHLIGHT_STROKE = '#4a9eff';
    let autoJumpTimer = null;

    // The asset info panel docks top-left in landscape (same corner as this
    // search box) and bottom in portrait, at a higher z-index — hide search
    // while it's open so the two never overlap/intercept each other's clicks.
    const infoPanel = document.getElementById('viz-info-panel');
    if (infoPanel && searchBox) {
        const syncSearchVisibility = () => {
            searchBox.style.display = infoPanel.classList.contains('open') ? 'none' : '';
        };
        new MutationObserver(syncSearchVisibility).observe(infoPanel, { attributes: true, attributeFilter: ['class'] });
        syncSearchVisibility();
    }

    function normalize(s) { return String(s || '').toLowerCase(); }

    function getMatches(q) {
        if (!nodeSelection) return [];
        const query = normalize(q).trim();
        if (!query) return [];
        return nodeSelection.data().filter(d => normalize(d.name).includes(query));
    }

    function resetHighlight() {
        if (!nodeSelection) return;
        nodeSelection.select('circle').attr('stroke', '#fff').attr('stroke-width', 2).style('opacity', null);
        nodeSelection.select('text').style('opacity', null);
        nodeSelection.select('image').style('opacity', null);
        if (linkSelection) linkSelection.style('opacity', null);
    }

    function applyHighlight(matches) {
        if (!nodeSelection) return;
        const matchIds = new Set(matches.map(d => d.id));

        nodeSelection.each(function (d) {
            const isMatch = matchIds.has(d.id);
            const sel = d3.select(this);
            sel.select('circle')
                .attr('stroke', isMatch ? HIGHLIGHT_STROKE : '#fff')
                .attr('stroke-width', isMatch ? 4 : 2)
                .style('opacity', isMatch ? null : DIM_OPACITY);
            sel.select('text').style('opacity', isMatch ? null : DIM_OPACITY);
            sel.select('image').style('opacity', isMatch ? null : DIM_OPACITY);
        });

        if (linkSelection) {
            linkSelection.style('opacity', d =>
                (matchIds.has(d.source.id) || matchIds.has(d.target.id)) ? null : DIM_OPACITY
            );
        }
    }

    function jumpToNode(d) {
        if (!d || !svg || !zoom) return;
        const viewBox = (svg.attr('viewBox') || '').split(/\s+/).map(Number);
        const width  = viewBox[2] || (container && container.clientWidth)  || 900;
        const height = viewBox[3] || (container && container.clientHeight) || 612;
        const scale  = 1.6;
        const t = d3.zoomIdentity
            .translate(width / 2 - d.x * scale, height / 2 - d.y * scale)
            .scale(scale);
        svg.transition().duration(600).call(zoom.transform, t);

        if (d.type === 'asset' && typeof openAssetModal === 'function') {
            openAssetModal(d.id);
        }
    }

    function typeLabel(d) {
        if (d.type === 'asset') return 'Asset';
        if (d.type === 'hub') return 'Hub';
        return 'Category';
    }

    function renderResults(matches) {
        if (!resultsList) return;
        if (!matches.length) {
            resultsList.hidden = true;
            resultsList.innerHTML = '';
            return;
        }
        resultsList.innerHTML = matches.slice(0, 8).map(d => `
            <li class="viz-search-result" data-id="${d.id}">
                ${d.name}
                <span class="result-type">${typeLabel(d)}</span>
            </li>`).join('');
        resultsList.hidden = false;

        resultsList.querySelectorAll('.viz-search-result').forEach(el => {
            el.addEventListener('click', () => {
                const match = matches.find(m => m.id === el.dataset.id);
                if (match) selectMatch(match);
            });
        });
    }

    function selectMatch(d) {
        clearTimeout(autoJumpTimer);
        input.value = d.name;
        applyHighlight([d]);
        renderResults([]);
        jumpToNode(d);
    }

    function handleInput() {
        clearTimeout(autoJumpTimer);
        const q = input.value.trim();

        if (!q) {
            resetHighlight();
            renderResults([]);
            return;
        }

        const matches = getMatches(q);
        applyHighlight(matches);
        renderResults(matches);

        if (matches.length === 1) {
            autoJumpTimer = setTimeout(() => jumpToNode(matches[0]), 450);
        }
    }

    input.addEventListener('input', handleInput);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const matches = getMatches(input.value);
            if (matches.length) selectMatch(matches[0]);
        } else if (e.key === 'Escape') {
            clearTimeout(autoJumpTimer);
            input.value = '';
            resetHighlight();
            renderResults([]);
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearTimeout(autoJumpTimer);
            input.value = '';
            resetHighlight();
            renderResults([]);
            input.focus();
        });
    }

    // Close the results dropdown when clicking outside the search box
    document.addEventListener('click', (e) => {
        if (searchBox && !searchBox.contains(e.target)) {
            renderResults([]);
        }
    });
})();
