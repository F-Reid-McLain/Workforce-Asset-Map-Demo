/* ===== SUBMISSION FORMS — Suggest an Asset / Request an Edit ===== */

// Both forms POST here; each sets its own hidden _subject field so the
// receiving inbox can be filtered/routed by subject line alone.
const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xqerrnlb';

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
    const submitBtn    = document.querySelector('#request-edit-form .form-submit-btn');

    let nodes = [];

    fetch('content/assets.json')
        .then(response => response.json())
        .then(data => {
            nodes = Object.entries(data).map(([id, d]) => ({
                id, name: d.name, category: d.category || ''
            }));
        })
        .catch(err => console.error('node-picker: could not load assets.json', err));

    function categoryLabel(cat) {
        return cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function clearSelection() {
        hiddenId.value = '';
        hiddenName.value = '';
        if (selectedNote) selectedNote.hidden = true;
        if (submitBtn) submitBtn.disabled = true;
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
        if (submitBtn) submitBtn.disabled = false;
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

    clearSelection();
}

/* ----- Repeatable "program" rows (Suggest an Asset / Request an Edit) ----- */
/* Submitters aren't expected to know this maps to the map's "branch-out"
   links under an asset — the form only ever talks about "programs". */
function initProgramRows() {
    const container = document.getElementById('program-rows');
    const addBtn    = document.getElementById('add-program-btn');
    if (!container || !addBtn) return;

    let rowCount = 0;

    function addRow() {
        rowCount += 1;
        const i = rowCount;
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
        row.querySelector('.form-remove-btn').addEventListener('click', () => row.remove());
        row.querySelector(`#program_${i}_url`).setAttribute('data-normalize-url', '');
        container.appendChild(row);
    }

    addBtn.addEventListener('click', addRow);
    addRow();
}

document.addEventListener('DOMContentLoaded', function () {
    initNodePicker();
    initProgramRows();

    initSubmissionForm(document.getElementById('submit-asset-form'), function (form) {
        const name = form.querySelector('[name="asset_name"]').value.trim();
        return `[WF Map Submission] New Asset: ${name}`;
    });

    initSubmissionForm(document.getElementById('request-edit-form'), function (form) {
        const name = form.querySelector('[name="node_name"]').value.trim();
        return `[WF Map Submission] Edit Request: ${name}`;
    });
});
