/* ===== SEARCH — directory list filter + map highlight/jump-to ===== */

/* ----- Shared tag-chip helpers ----- */
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Returns the unique tags found across `tagArrays` (array of string-arrays),
// most-used first — so the chip row leads with the broadest, most useful tags.
function tagFrequency(tagArrays) {
    const counts = new Map();
    tagArrays.forEach(tags => (tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

// Renders toggleable pill buttons into `container`; calls onChange(selectedSet)
// whenever the selection changes. Returns the live selected-tags Set.
function buildTagChips(container, allTags, onChange) {
    const selected = new Set();
    if (!container || !allTags.length) return selected;

    container.innerHTML = allTags.map(tag =>
        `<button type="button" class="tag-chip" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
    ).join('');

    container.querySelectorAll('.tag-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const tag = btn.dataset.tag;
            if (selected.has(tag)) {
                selected.delete(tag);
                btn.classList.remove('active');
            } else {
                selected.add(tag);
                btn.classList.add('active');
            }
            onChange(selected);
        });
    });

    return selected;
}

/* ----- Directory page ----- */
(function () {
    const input = document.getElementById('directory-search-input');
    if (!input) return;

    const clearBtn      = document.getElementById('directory-search-clear');
    const emptyMsg       = document.getElementById('directory-empty');
    const chipContainer  = document.getElementById('directory-tag-chips');
    const groups         = Array.from(document.querySelectorAll('.directory-group'));
    let selectedTags     = new Set();

    function applyFilter() {
        const q = input.value.trim().toLowerCase();
        let anyGroupVisible = false;

        groups.forEach(group => {
            const heading = group.querySelector('h3');
            const headingTextMatches = !q || (heading && heading.textContent.toLowerCase().includes(q));
            let groupHasMatch = false;

            group.querySelectorAll('.asset-link').forEach(link => {
                const textMatches = headingTextMatches || link.textContent.toLowerCase().includes(q);
                const id    = link.getAttribute('href').substring(1);
                const asset = typeof assetData !== 'undefined' ? assetData[id] : null;
                const tagMatches = selectedTags.size === 0 ||
                    !!(asset && asset.tags && asset.tags.some(t => selectedTags.has(t)));
                const matches = textMatches && tagMatches;

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

    // Tag chips depend on assetData, which directory.js fetches asynchronously —
    // poll briefly rather than coupling to its exact load sequence.
    (function whenAssetDataReady() {
        if (typeof assetData !== 'undefined' && Object.keys(assetData).length) {
            const allTags = tagFrequency(Object.values(assetData).map(a => a.tags || []));
            selectedTags = buildTagChips(chipContainer, allTags, sel => {
                selectedTags = sel;
                applyFilter();
            });
        } else {
            setTimeout(whenAssetDataReady, 50);
        }
    })();
})();

/* ----- Map page ----- */
(function () {
    const input = document.getElementById('map-search-input');
    if (!input) return;

    const clearBtn      = document.getElementById('map-search-clear');
    const resultsList    = document.getElementById('viz-search-results');
    const searchBox       = document.getElementById('viz-search');
    const container        = document.getElementById('network-visualization');
    const chipContainer   = document.getElementById('map-tag-chips');

    const DIM_OPACITY      = 0.12;
    const HIGHLIGHT_STROKE = '#4a9eff';
    let autoJumpTimer = null;
    let selectedTags   = new Set();

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

    // Combines the typed query (substring on name) with any selected tag
    // chips (OR among chips, AND with the query) into one match set.
    function computeMatches() {
        if (!nodeSelection) return [];
        const query   = normalize(input.value).trim();
        const hasTags = selectedTags.size > 0;
        if (!query && !hasTags) return [];

        return nodeSelection.data().filter(d => {
            const textOk = !query || normalize(d.name).includes(query);
            const tagOk  = !hasTags || (d.tags && d.tags.some(t => selectedTags.has(t)));
            return textOk && tagOk;
        });
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
        const matches = computeMatches();

        if (!matches.length) {
            resetHighlight();
            renderResults([]);
            return;
        }

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
            const matches = computeMatches();
            if (matches.length) selectMatch(matches[0]);
        } else if (e.key === 'Escape') {
            clearTimeout(autoJumpTimer);
            input.value = '';
            handleInput();
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearTimeout(autoJumpTimer);
            input.value = '';
            handleInput();
            input.focus();
        });
    }

    // Close the results dropdown when clicking outside the search box or the
    // tag chips (chips live outside #viz-search, in .viz-header, and re-render
    // the dropdown on click — without this exclusion this handler would fire
    // right after and immediately wipe out the results the chip just produced).
    document.addEventListener('click', (e) => {
        const inSearchBox = searchBox && searchBox.contains(e.target);
        const inChips     = chipContainer && chipContainer.contains(e.target);
        if (!inSearchBox && !inChips) {
            renderResults([]);
        }
    });

    // Tag chips depend on nodeSelection, which viz-engine.js populates
    // asynchronously — poll briefly rather than coupling to its load order.
    (function whenNodesReady() {
        if (nodeSelection) {
            const allTags = tagFrequency(nodeSelection.data().map(d => d.tags || []));
            selectedTags = buildTagChips(chipContainer, allTags, sel => {
                selectedTags = sel;
                handleInput();
            });
        } else {
            setTimeout(whenNodesReady, 50);
        }
    })();
})();
