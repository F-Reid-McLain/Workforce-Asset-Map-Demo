/* ===== SUBMISSION FORMS — Suggest an Asset / Request an Edit ===== */

// Both forms POST here; each sets its own hidden _subject field so the
// receiving inbox can be filtered/routed by subject line alone.
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xqerrnlb';

// Matches js/viz-engine.js's CATEGORY_COLORS — kept as a small, separate
// copy here rather than shared/imported since this is the only other place
// on the site that needs to know a category's color, and pulling in the
// whole viz engine just for this map would be a lot of unrelated code.
const PREVIEW_CATEGORY_COLORS = {
    'colleges':           '#4d748c',
    'faith-based':        '#e7decf',
    'special-population': '#afa66d',
    'job-training':       '#de5e6d',
    'community-dev':      '#31556b',
    'k12-secondary':      '#c82236'
};

// Request an Edit's currently-selected node, full record from
// content/assets.json (not just id/name/category) — read by
// updateEditPreview()/updateSatellitePreview() to show the organization
// exactly as it reads today. Stays null on Suggest an Asset, which has no
// node picker.
let selectedNodeData = null;

// Snapshot of the selected node's original values, taken the moment it's
// picked — compared against the live (possibly edited) field values in
// computeChangeSummary() to know what's actually being proposed.
let originalNodeSnapshot = null;

// Fields marked data-normalize-url accept a bare domain (e.g. "acme.com")
// instead of requiring the submitter to type a scheme — native type="url"
// inputs reject those and silently block the whole form's submission, which
// is what a plain text field + this normalization avoids.
function normalizeUrlFields(formEl) {
    formEl.querySelectorAll('[data-normalize-url]').forEach(field => {
        const value = field.value.trim();
        if (value && !/^https?:\/\//i.test(value)) {
            field.value = `https://${value}`;
        }
    });
}

/* ----- Shared submit handler ----- */
function initSubmissionForm(formEl, buildSubject) {
    if (!formEl) return;

    const submitBtn = formEl.querySelector('.form-submit-btn');
    const errorEl   = formEl.querySelector('.form-error');

    formEl.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }

        normalizeUrlFields(formEl);

        const subjectField = formEl.querySelector('input[name="_subject"]');
        if (subjectField) subjectField.value = buildSubject(formEl);

        const originalLabel = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';

        try {
            const response = await fetch(FORMSPREE_ENDPOINT, {
                method: 'POST',
                body: new FormData(formEl),
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const successEl = document.getElementById(formEl.dataset.successTarget);
            formEl.hidden = true;
            if (successEl) successEl.hidden = false;
        } catch (err) {
            console.error('submission failed', err);
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
            if (errorEl) {
                errorEl.textContent = 'Something went wrong sending your submission. Please try again, or email us directly.';
                errorEl.hidden = false;
            }
        }
    });
}

/* ----- Node picker (Request an Edit page) ----- */
/* Same filtered-list-as-you-type pattern as the directory/map search in
   js/search.js, applied here to picking an existing node instead of jumping
   to one on the map. */
function initNodePicker() {
    const input = document.getElementById('node-picker-input');
    if (!input) return;

    const resultsList  = document.getElementById('node-picker-results');
    const hiddenId      = document.getElementById('node-picker-id');
    const hiddenName    = document.getElementById('node-picker-name');
    const selectedNote = document.getElementById('node-picker-selected');

    let nodes = [];

    fetch('content/assets.json')
        .then(response => response.json())
        .then(data => {
            nodes = Object.entries(data).map(([id, d]) => ({ id, ...d }));
        })
        .catch(err => console.error('node-picker: could not load assets.json', err));

    function categoryLabel(cat) {
        return cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function clearSelection() {
        hiddenId.value = '';
        hiddenName.value = '';
        if (selectedNote) selectedNote.hidden = true;
        selectedNodeData = null;
        originalNodeSnapshot = null;
        resetEditFields();
        updateEditPreview();
    }

    function selectNode(node) {
        input.value = node.name;
        hiddenId.value = node.id;
        hiddenName.value = node.name;
        renderResults([]);
        if (selectedNote) {
            selectedNote.textContent = `Selected: ${node.name}`;
            selectedNote.hidden = false;
        }
        selectedNodeData = node;
        originalNodeSnapshot = {
            name: node.name || '',
            description: node.description || '',
            impact: node.impact || '',
            website: node.website || '',
            programLabels: (node.links || []).map(l => l.label)
        };
        fillEditFields(node);
        updateEditPreview();
    }

    function renderResults(matches) {
        if (!resultsList) return;
        if (!matches.length) {
            resultsList.hidden = true;
            resultsList.innerHTML = '';
            return;
        }
        resultsList.innerHTML = matches.slice(0, 8).map(n => `
            <li class="node-picker-result" data-id="${n.id}">
                ${n.name}
                <span class="result-category">${categoryLabel(n.category)}</span>
            </li>`).join('');
        resultsList.hidden = false;

        resultsList.querySelectorAll('.node-picker-result').forEach(el => {
            el.addEventListener('click', () => {
                const match = matches.find(m => m.id === el.dataset.id);
                if (match) selectNode(match);
            });
        });
    }

    input.addEventListener('input', function () {
        clearSelection();
        const q = input.value.trim().toLowerCase();
        if (!q) { renderResults([]); return; }
        renderResults(nodes.filter(n => n.name.toLowerCase().includes(q)));
    });

    document.addEventListener('click', function (e) {
        if (!input.contains(e.target) && !(resultsList && resultsList.contains(e.target))) {
            renderResults([]);
        }
    });

    ['change_details', 'edit-name', 'edit-description', 'edit-impact', 'edit-website'].forEach(id => {
        const field = document.getElementById(id);
        if (field) field.addEventListener('input', updateEditPreview);
    });

    ['edit-description', 'edit-impact'].forEach(id => {
        const field = document.getElementById(id);
        if (field) field.addEventListener('input', () => autoGrowTextarea(field));
    });

    clearSelection();
}

/* ----- Shared preview helpers ----- */
// Matches js/directory.js's own shortenUrl — a full path is too long for
// the (already narrow) preview panel, same as the real info panel.
function shortenUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
        return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
}

function displayUrl(value) {
    if (!value) return '';
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Grows a textarea to fit its content instead of leaving long real
// descriptions scrolling inside a fixed-height box — resetting height to
// auto first is what lets scrollHeight shrink back down again if text is
// removed, not just grow.
function autoGrowTextarea(el) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
}

// Reads whatever program rows currently exist on the page (Suggest an
// Asset or Request an Edit both use the same #program-rows markup).
function collectProgramRows() {
    return Array.from(document.querySelectorAll('#program-rows .dynamic-row')).map(row => {
        const nameField = row.querySelector('[id$="_name"]');
        const urlField  = row.querySelector('[id$="_url"]');
        return { label: nameField ? nameField.value.trim() : '', url: urlField ? urlField.value.trim() : '' };
    }).filter(p => p.label || p.url);
}

function truncateLabel(str, maxLen) {
    return str.length > maxLen ? str.slice(0, maxLen - 1).trimEnd() + '…' : str;
}

// Draws each current program row as a small satellite node connected to
// the main preview circle by a thin line — the same "branch-out" shape
// js/viz-engine.js's branchOutNode() draws on the real map when you click
// an asset with links, just laid out as a fixed upward fan instead of a
// live force layout. On Request an Edit the rows are already seeded from
// the organization's real programs (see fillEditFields), so this always
// reflects the current proposed list, not just what's newly typed.
function updateSatellitePreview() {
    const satGroup = document.getElementById('preview-satellites');
    if (!satGroup) return;
    while (satGroup.firstChild) satGroup.removeChild(satGroup.firstChild);

    const categoryField = document.getElementById('category');
    const category = categoryField ? categoryField.value : (selectedNodeData ? selectedNodeData.category : '');
    const color = PREVIEW_CATEGORY_COLORS[category] || '#afa66d';

    const programs = collectProgramRows();
    if (!programs.length) return;

    const CX = 140, CY = 140, RADIUS = 95, SAT_R = 14;
    const svgNS = 'http://www.w3.org/2000/svg';
    const baseAngle = -Math.PI / 2; // straight up
    const spreadDeg = programs.length <= 1 ? 0 : Math.min(140, 40 + (programs.length - 1) * 25);
    const spreadRad = spreadDeg * Math.PI / 180;

    programs.forEach((p, i) => {
        const t = programs.length === 1 ? 0 : (i / (programs.length - 1)) - 0.5;
        const angle = baseAngle + t * spreadRad;
        const sx = CX + RADIUS * Math.cos(angle);
        const sy = CY + RADIUS * Math.sin(angle);

        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', CX); line.setAttribute('y1', CY);
        line.setAttribute('x2', sx); line.setAttribute('y2', sy);
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-opacity', '0.55');
        satGroup.appendChild(line);

        const circle = document.createElementNS(svgNS, 'circle');
        circle.setAttribute('cx', sx); circle.setAttribute('cy', sy);
        circle.setAttribute('r', SAT_R);
        circle.setAttribute('fill', color); circle.setAttribute('fill-opacity', '0.3');
        circle.setAttribute('stroke', color); circle.setAttribute('stroke-width', '1.5');
        satGroup.appendChild(circle);

        const text = document.createElementNS(svgNS, 'text');
        text.setAttribute('x', sx); text.setAttribute('y', sy + SAT_R + 13);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#fff');
        text.setAttribute('font-size', '9');
        text.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
        text.textContent = truncateLabel(p.label || p.url, 11);
        satGroup.appendChild(text);
    });
}

// Suggest an Asset's full preview — mirrors js/directory.js's
// openAssetModal exactly (same conditional sections, same order) so this
// is a true preview of the real info panel, not a lookalike. Guarded on
// #asset_name so it's a no-op on Request an Edit, which shares these same
// preview element ids but is driven by updateEditPreview() instead.
function updateInfoPanelPreview() {
    const nameField = document.getElementById('asset_name');
    const titleEl    = document.getElementById('preview-info-title');
    const bodyEl      = document.getElementById('preview-info-body');
    if (!nameField || !titleEl || !bodyEl) return;

    const descriptionField = document.getElementById('description');
    const impactField      = document.getElementById('impact');
    const websiteField     = document.getElementById('website');

    titleEl.textContent = nameField.value.trim() || 'Your Organization';

    const description = descriptionField.value.trim();
    const impact       = impactField.value.trim();
    const website       = websiteField.value.trim();
    const programs       = collectProgramRows();

    let html = description
        ? `<p>${escapeHtml(description)}</p>`
        : `<p class="node-preview-placeholder">Your description will show up here as you type it below — exactly as visitors will see it when they click on your organization on the map.</p>`;

    if (impact) html += `<p><strong>Community Impact:</strong> ${escapeHtml(impact)}</p>`;

    if (programs.length) {
        html += `<p><strong>Related Programs:</strong></p><div class="related-links">`;
        html += programs.map(p => `<a href="#">${escapeHtml(p.label || p.url)}</a>`).join('');
        html += `</div>`;
    }

    if (website) {
        html += `<p><strong>Website:</strong> <a href="#">${escapeHtml(shortenUrl(displayUrl(website)))}</a></p>`;
    }

    bodyEl.innerHTML = html;
}

// Request an Edit: one-time side effect when a node is newly picked —
// loads its real values into the actual editable fields (not just a
// read-only echo) and seeds the program rows from its real links.
// Called once from initNodePicker's selectNode(); never from
// updateEditPreview() itself, or every keystroke elsewhere would stomp
// on whatever the requester is mid-typing.
function fillEditFields(node) {
    const nameField        = document.getElementById('edit-name');
    const descriptionField = document.getElementById('edit-description');
    const impactField      = document.getElementById('edit-impact');
    const websiteField     = document.getElementById('edit-website');
    if (!nameField) return;

    nameField.value = node.name || '';
    descriptionField.value = node.description || '';
    impactField.value = node.impact || '';
    websiteField.value = node.website || '';
    [nameField, descriptionField, impactField, websiteField].forEach(f => { f.disabled = false; });
    autoGrowTextarea(descriptionField);
    autoGrowTextarea(impactField);

    clearProgramRows();
    (node.links || []).forEach(l => addProgramRow({ label: l.label, url: l.url, description: l.description }));
}

// Request an Edit: mirrors clearSelection() — empties and disables the
// editable fields and drops any seeded program rows.
function resetEditFields() {
    const nameField        = document.getElementById('edit-name');
    const descriptionField = document.getElementById('edit-description');
    const impactField      = document.getElementById('edit-impact');
    const websiteField     = document.getElementById('edit-website');
    if (!nameField) return;

    [nameField, descriptionField, impactField, websiteField].forEach(f => { f.value = ''; f.disabled = true; });
    autoGrowTextarea(descriptionField);
    autoGrowTextarea(impactField);
    clearProgramRows();
}

// Compares the live (possibly edited) field values against the snapshot
// taken when the node was selected — this is what actually gates
// submission and drives the "What You're Changing" summary, rather than
// requiring a separate free-text description of the change.
function computeChangeSummary() {
    if (!originalNodeSnapshot) return [];

    const nameField        = document.getElementById('edit-name');
    const descriptionField = document.getElementById('edit-description');
    const impactField      = document.getElementById('edit-impact');
    const websiteField     = document.getElementById('edit-website');
    const notesField       = document.getElementById('change_details');
    if (!nameField) return [];

    const changes = [];
    if (nameField.value.trim() !== originalNodeSnapshot.name) changes.push('Name changed');
    if (descriptionField.value.trim() !== originalNodeSnapshot.description) changes.push('Description edited');
    if (impactField.value.trim() !== originalNodeSnapshot.impact) changes.push('Impact edited');
    if (websiteField.value.trim() !== originalNodeSnapshot.website) changes.push('Website changed');

    const currentLabels = collectProgramRows().map(p => p.label || p.url);
    const added   = currentLabels.filter(l => !originalNodeSnapshot.programLabels.includes(l));
    const removed = originalNodeSnapshot.programLabels.filter(l => !currentLabels.includes(l));
    if (added.length)   changes.push(`${added.length} program${added.length > 1 ? 's' : ''} added`);
    if (removed.length) changes.push(`${removed.length} program${removed.length > 1 ? 's' : ''} removed`);

    if (notesField && notesField.value.trim()) changes.push('Additional note included');

    return changes;
}

// Request an Edit's live refresh — read-only: reflects whatever the
// editable fields and program rows currently hold (never writes to them,
// see fillEditFields/resetEditFields for the one-time setup that does),
// updates the SVG preview, the Related Programs mirror, the change
// summary, and the submit button's gating. Guarded on #node-picker-input
// so it's a no-op on Suggest an Asset.
function updateEditPreview() {
    const pickerInput = document.getElementById('node-picker-input');
    if (!pickerInput) return;

    const nameField      = document.getElementById('edit-name');
    const label            = document.getElementById('preview-label');
    const circle            = document.getElementById('preview-circle');
    const image              = document.getElementById('preview-image');
    const programsMirror   = document.getElementById('preview-programs-mirror');
    const changeBox        = document.getElementById('preview-change-box');
    const changeListEl     = document.getElementById('preview-change-list');
    const submitBtn        = document.querySelector('#request-edit-form .form-submit-btn');
    const noChangesHint    = document.getElementById('no-changes-hint');
    if (!nameField) return;

    if (!selectedNodeData) {
        label.textContent = 'Pick an organization';
        circle.setAttribute('fill', '#4d748c');
        circle.setAttribute('stroke-dasharray', '6,6');
        image.style.display = 'none';
        image.removeAttribute('href');
        if (programsMirror) programsMirror.innerHTML = '';
        if (changeBox) changeBox.hidden = true;
        if (submitBtn) submitBtn.disabled = true;
        if (noChangesHint) noChangesHint.hidden = true;
        updateSatellitePreview();
        return;
    }

    const d = selectedNodeData;
    label.textContent = truncateLabel(nameField.value.trim() || d.name, 24);

    if (d.image) {
        image.setAttribute('href', d.image);
        image.style.display = '';
        circle.setAttribute('fill', '#ffffff');
        circle.setAttribute('stroke-dasharray', '0');
    } else {
        image.style.display = 'none';
        image.removeAttribute('href');
        circle.setAttribute('fill', PREVIEW_CATEGORY_COLORS[d.category] || '#4d748c');
        circle.setAttribute('stroke-dasharray', '6,6');
    }

    if (programsMirror) {
        const programs = collectProgramRows();
        programsMirror.innerHTML = programs.length
            ? programs.map(p => `<a href="#">${escapeHtml(p.label || p.url)}</a>`).join('')
            : '<p class="node-preview-placeholder">None yet.</p>';
    }

    const changes = computeChangeSummary();
    if (changeBox) {
        changeBox.hidden = !changes.length;
        if (changeListEl) changeListEl.innerHTML = changes.map(c => `<li>${escapeHtml(c)}</li>`).join('');
    }
    if (submitBtn) submitBtn.disabled = changes.length === 0;
    if (noChangesHint) noChangesHint.hidden = changes.length !== 0;

    updateSatellitePreview();
}

/* ----- Live node preview (Suggest an Asset) ----- */
/* Mirrors, at a glance, how the actual map draws an asset node in
   js/viz-engine.js: a circle colored by category (or white with the logo
   filling it), a dashed ring when there's no logo yet, and a name label
   underneath. Not the full map rendering — just enough to show a
   non-technical submitter what their entry will look like. */
function initNodePreview() {
    const circle = document.getElementById('preview-circle');
    const image  = document.getElementById('preview-image');
    const label  = document.getElementById('preview-label');
    // asset_name only exists on Suggest an Asset — Request an Edit shares
    // these same preview element ids but is driven by updateEditPreview()
    // (wired from initNodePicker) instead, so bail out here on that page.
    const nameField = document.getElementById('asset_name');
    if (!circle || !image || !label || !nameField) return;

    const categoryField = document.getElementById('category');
    const logoField      = document.getElementById('logo');
    const logoUrlField  = document.getElementById('logo_url');

    function updateLabel() {
        const name = nameField.value.trim();
        label.textContent = name ? truncateLabel(name, 24) : 'Your Organization';
        updateInfoPanelPreview();
    }

    function updateColor() {
        const hasLogo = image.style.display !== 'none';
        if (hasLogo) {
            circle.setAttribute('fill', '#ffffff');
            circle.setAttribute('stroke-dasharray', '0');
        } else {
            circle.setAttribute('fill', PREVIEW_CATEGORY_COLORS[categoryField.value] || '#4d748c');
            circle.setAttribute('stroke-dasharray', '6,6');
        }
        updateSatellitePreview();
    }

    function showImage(href) {
        image.setAttribute('href', href);
        image.style.display = '';
        updateColor();
    }

    function hideImage() {
        image.removeAttribute('href');
        image.style.display = 'none';
        updateColor();
    }

    function updateLogo() {
        const file = logoField.files && logoField.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => showImage(reader.result);
            reader.readAsDataURL(file);
            return;
        }
        const url = logoUrlField.value.trim();
        if (url) {
            showImage(/^https?:\/\//i.test(url) ? url : `https://${url}`);
        } else {
            hideImage();
        }
    }

    nameField.addEventListener('input', updateLabel);
    categoryField.addEventListener('change', updateColor);
    logoField.addEventListener('change', updateLogo);
    logoUrlField.addEventListener('input', updateLogo);

    const descriptionField = document.getElementById('description');
    const impactField      = document.getElementById('impact');
    const websiteField     = document.getElementById('website');
    descriptionField.addEventListener('input', updateInfoPanelPreview);
    impactField.addEventListener('input', updateInfoPanelPreview);
    websiteField.addEventListener('input', updateInfoPanelPreview);
    updateInfoPanelPreview();
    updateColor();
}

/* ----- Repeatable "program" rows (Suggest an Asset / Request an Edit) ----- */
/* Submitters aren't expected to know this maps to the map's "branch-out"
   links under an asset — the form only ever talks about "programs". On
   Request an Edit these same rows also double as the organization's
   existing programs, pre-filled by fillEditFields() so editing or
   removing one is just editing or removing its row — no separate
   read-only/editable split needed. */
let programRowCount = 0;

function refreshProgramPreviews() {
    updateInfoPanelPreview();
    updateEditPreview();
    updateSatellitePreview();
}

function addProgramRow(prefill) {
    prefill = prefill || {};
    const container = document.getElementById('program-rows');
    if (!container) return;

    programRowCount += 1;
    const i = programRowCount;
    const row = document.createElement('div');
    row.className = 'dynamic-row';
    row.innerHTML = `
        <div class="dynamic-row-field">
            <label for="program_${i}_name">Program name</label>
            <input class="form-input" type="text" id="program_${i}_name" name="program_${i}_name">
        </div>
        <div class="dynamic-row-field">
            <label for="program_${i}_url">Link (optional)</label>
            <input class="form-input" type="text" id="program_${i}_url" name="program_${i}_url" placeholder="e.g. yoursite.com/program">
        </div>
        <div class="dynamic-row-field">
            <label for="program_${i}_description">Short description (optional)</label>
            <input class="form-input" type="text" id="program_${i}_description" name="program_${i}_description">
        </div>
        <button type="button" class="form-remove-btn">Remove</button>
    `;
    // Set via the DOM property, not embedded in the innerHTML template
    // above — prefilled values come from real org data and may contain
    // quotes, which would otherwise break out of the value="" attribute.
    row.querySelector(`#program_${i}_name`).value = prefill.label || '';
    row.querySelector(`#program_${i}_url`).value = prefill.url || '';
    row.querySelector(`#program_${i}_description`).value = prefill.description || '';
    row.querySelector(`#program_${i}_url`).setAttribute('data-normalize-url', '');

    row.querySelector('.form-remove-btn').addEventListener('click', () => { row.remove(); refreshProgramPreviews(); });
    row.querySelectorAll('input').forEach(input => input.addEventListener('input', refreshProgramPreviews));
    container.appendChild(row);
    refreshProgramPreviews();
}

function clearProgramRows() {
    const container = document.getElementById('program-rows');
    if (container) container.innerHTML = '';
    programRowCount = 0;
    refreshProgramPreviews();
}

function initProgramRows() {
    const addBtn = document.getElementById('add-program-btn');
    if (!addBtn) return;

    addBtn.addEventListener('click', () => addProgramRow());

    // Suggest an Asset starts with one empty row to fill in. Request an
    // Edit has no starter row — it seeds from the selected node's real
    // programs instead, once one is picked (see fillEditFields).
    if (!document.getElementById('node-picker-input')) addProgramRow();
}

document.addEventListener('DOMContentLoaded', function () {
    initNodePicker();
    initProgramRows();
    initNodePreview();

    initSubmissionForm(document.getElementById('submit-asset-form'), function (form) {
        const name = form.querySelector('[name="asset_name"]').value.trim();
        return `[WF Map Submission] New Asset: ${name}`;
    });

    initSubmissionForm(document.getElementById('request-edit-form'), function (form) {
        const name = form.querySelector('[name="node_name"]').value.trim();
        return `[WF Map Submission] Edit Request: ${name}`;
    });
});
