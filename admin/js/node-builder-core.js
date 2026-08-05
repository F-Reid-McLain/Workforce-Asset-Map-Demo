/* ===== NODE BUILDER — CORE ===== */
/* Shared by admin/node-builder.html (standalone, hand-filled) and
   admin/dashboard.html (pre-filled from a parsed email submission via
   prefillBuilder()). Assumes the host page has the same field ids:
   name, id, category, tags, image, website, description, impact,
   links-container, add-link-btn, id-warning, generate-btn, output,
   output-card, copy-btn. entry-mode-note is optional (dashboard only).
   github-token-input/save-github-token-btn/github-token-status and
   map-preview-card/map-preview-frame are optional too — present on both
   pages now, but guarded here in case a future host page omits either. */

let existingIds = new Set();
let idManuallyEdited = false;

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// Matches js/viz-engine.js's CATEGORY_COLORS and forms.js's own copy of the
// same palette — kept as a small separate copy here rather than shared,
// since this is the only other place that needs to know a category's
// color and pulling in the whole viz engine just for this would be a lot
// of unrelated code.
const PREVIEW_CATEGORY_COLORS = {
    'colleges':           '#4d748c',
    'faith-based':        '#e7decf',
    'special-population': '#afa66d',
    'job-training':       '#de5e6d',
    'community-dev':      '#31556b',
    'k12-secondary':      '#c82236'
};

function truncateLabel(str, maxLen) {
    return str.length > maxLen ? str.slice(0, maxLen - 1).trimEnd() + '…' : str;
}

/* ----- Publish to GitHub -----
   Commits the current builder fields straight into content/assets.json on
   main via GitHub's Contents API — no local git needed. Requires a token
   with contents read/write on this one repo (fine-grained PAT
   recommended), pasted into whichever page's token field and kept in
   localStorage under one shared key, so entering it once on either page
   carries over to the other. A real, live credential, unlike the
   secret-free Microsoft sign-in the Dashboard also uses: treat it like a
   password, revoke it on GitHub if this machine is ever lost or shared. */
const GITHUB_OWNER = 'F-Reid-McLain';
const GITHUB_REPO = 'Workforce-Asset-Map-Demo';
const GITHUB_BRANCH = 'main';
const GITHUB_ASSETS_PATH = 'content/assets.json';
const GITHUB_TOKEN_STORAGE_KEY = 'wf_github_token';

function getGithubToken() {
    return localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY) || '';
}

function initGithubTokenField() {
    const input = document.getElementById('github-token-input');
    const status = document.getElementById('github-token-status');
    const saveBtn = document.getElementById('save-github-token-btn');
    if (!input || !status || !saveBtn) return;

    const saved = getGithubToken();
    if (saved) {
        input.value = saved;
        status.textContent = 'Saved on this device.';
    }
    saveBtn.addEventListener('click', () => {
        const value = input.value.trim();
        if (value) {
            localStorage.setItem(GITHUB_TOKEN_STORAGE_KEY, value);
            status.textContent = 'Saved on this device.';
        } else {
            localStorage.removeItem(GITHUB_TOKEN_STORAGE_KEY);
            status.textContent = 'Cleared.';
        }
    });
}

async function githubFetch(path, options = {}) {
    const token = getGithubToken();
    if (!token) throw new Error('No GitHub token set — paste one into the field above and click Save.');
    const response = await fetch(`https://api.github.com${path}`, {
        ...options,
        headers: {
            ...(options.headers || {}),
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json'
        }
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`GitHub API error ${response.status}: ${body}`);
    }
    return response.json();
}

// btoa/atob only handle Latin-1 — descriptions etc. routinely contain
// characters outside that range, so both directions go through a UTF-8
// escape/unescape pass first.
function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}
function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(b64)));
}

// Fetches the live file fresh (not a cached copy from page load) so the
// sha used for the write always matches whatever's actually on GitHub
// right now — if someone else published in between, this PUT 409s instead
// of silently clobbering their commit. `source` just labels the commit
// message so history can tell which tool made a given change.
async function publishNodeToGithub(id, nodeObj, source = 'Submissions Dashboard') {
    const file = await githubFetch(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_ASSETS_PATH}?ref=${GITHUB_BRANCH}`
    );
    const assets = JSON.parse(base64ToUtf8(file.content.replace(/\n/g, '')));
    const isNewEntry = !(id in assets);
    assets[id] = nodeObj;

    const newContent = JSON.stringify(assets, null, 2) + '\n';

    await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_ASSETS_PATH}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: `${isNewEntry ? 'Add' : 'Update'} "${nodeObj.name}" via ${source}`,
            content: utf8ToBase64(newContent),
            sha: file.sha,
            branch: GITHUB_BRANCH
        })
    });
}

function slugify(text) {
    return text.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function checkIdCollision() {
    const idField = document.getElementById('id');
    const idWarning = document.getElementById('id-warning');
    const id = idField.value.trim();
    // Disabled means this id is intentionally locked to the existing node
    // being edited in place (see prefillBuilder's lockId branch, used by
    // both the email Request-an-Edit path and the Manage view's Edit
    // button) — matching its own id there is expected, not a collision.
    const collides = !idField.disabled && id && existingIds.has(id);
    idWarning.hidden = !collides;
    idWarning.textContent = collides ? `"${id}" is already used by an existing node — pick a different id.` : '';
}

function addLinkRow(label = '', url = '', description = '') {
    const linksContainer = document.getElementById('links-container');
    const row = document.createElement('div');
    row.className = 'link-row';
    row.innerHTML = `
        <input type="text" placeholder="Label" class="link-label">
        <input type="url" placeholder="https://" class="link-url">
        <textarea placeholder="Description" class="link-description"></textarea>
        <button type="button" class="remove-link-btn">&times;</button>
    `;
    // Set via the DOM property, not embedded in the innerHTML template above
    // — values pulled from a real submission may contain quotes, which
    // would otherwise break out of a value="" attribute.
    row.querySelector('.link-label').value = label;
    row.querySelector('.link-url').value = url;
    row.querySelector('.link-description').value = description;
    row.querySelector('.remove-link-btn').addEventListener('click', () => row.remove());
    linksContainer.appendChild(row);
}

function clearLinkRows() {
    document.getElementById('links-container').innerHTML = '';
}

function buildNodeObject() {
    const tags = document.getElementById('tags').value
        .split(',').map(t => t.trim()).filter(Boolean);

    const links = Array.from(document.querySelectorAll('#links-container .link-row'))
        .map(row => ({
            label: row.querySelector('.link-label').value.trim(),
            url: row.querySelector('.link-url').value.trim(),
            description: row.querySelector('.link-description').value.trim()
        }))
        .filter(link => link.label || link.url || link.description);

    const imageName = document.getElementById('image').value.trim();
    let website = document.getElementById('website').value.trim();
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;

    return {
        name: document.getElementById('name').value.trim(),
        category: document.getElementById('category').value,
        tags,
        image: imageName ? (imageName.startsWith('assets/logos/') ? imageName : `assets/logos/${imageName}`) : '',
        description: document.getElementById('description').value.trim(),
        impact: document.getElementById('impact').value.trim(),
        links,
        website
    };
}

function buildSnippet(id, obj) {
    const inner = JSON.stringify(obj, null, 2)
        .split('\n')
        .map(line => '  ' + line)
        .join('\n')
        .trimStart();
    return `  "${id}": ${inner},`;
}

// Populates the form from a parsed submission. `fields.links` is an array
// of {label, url, description}. `fields.lockId`, if set, means this is an
// edit-request submission targeting an existing node — the id field is
// locked to that node's real id (not slug-generated) and entry-mode-note
// (dashboard only) explains this replaces rather than adds an entry.
function prefillBuilder(fields) {
    document.getElementById('name').value = fields.name || '';
    document.getElementById('category').value = fields.category || 'colleges';
    document.getElementById('tags').value = (fields.tags || []).join(', ');
    document.getElementById('image').value = fields.image || '';
    document.getElementById('website').value = fields.website || '';
    document.getElementById('description').value = fields.description || '';
    document.getElementById('impact').value = fields.impact || '';

    clearLinkRows();
    (fields.links || []).forEach(l => addLinkRow(l.label, l.url, l.description));
    if (!(fields.links || []).length) addLinkRow();

    const idField = document.getElementById('id');
    if (fields.lockId) {
        idField.value = fields.lockId;
        idField.disabled = true;
        idManuallyEdited = true; // stop the name-field listener from overwriting it
    } else {
        idField.disabled = false;
        idManuallyEdited = false;
        idField.value = slugify(fields.name || '');
    }
    checkIdCollision();

    const note = document.getElementById('entry-mode-note');
    if (note) {
        note.hidden = false;
        note.textContent = fields.lockId
            ? `This will REPLACE the existing "${fields.lockId}" entry in content/assets.json — find that key and swap in the generated block below.`
            : 'This is a NEW entry — add the generated block below as a new key in content/assets.json.';
    }

    document.getElementById('output-card').hidden = true;

    updateBuilderPreview();
    refreshMapPreview(); // immediate, not debounced — this is a one-time programmatic fill, not a keystroke
}

/* ----- Live preview -----
   Two tiers, both driven off buildNodeObject() so there's one source of
   truth: an always-on SVG mini-preview (cheap, updates on every keystroke,
   mirrors submit-asset.html's own live preview) for instant feedback on
   color/logo/label/links, and the full embedded map (expensive — a real
   fetch + D3 force layout — so debounced) for exact positional context.
   Both are optional per-page: guarded on their own elements so a page
   missing either just skips that tier silently. */

function updateBuilderPreview() {
    const circle = document.getElementById('preview-circle');
    const image = document.getElementById('preview-image');
    const label = document.getElementById('preview-label');
    if (!circle || !image || !label) return; // no live-preview panel on this page

    const obj = buildNodeObject();
    const color = PREVIEW_CATEGORY_COLORS[obj.category] || '#4d748c';

    label.textContent = truncateLabel(obj.name || 'Your Organization', 24);

    function showImage(href) {
        image.setAttribute('href', href);
        image.style.display = '';
        circle.setAttribute('fill', '#ffffff');
        circle.setAttribute('stroke-dasharray', '0');
    }
    function hideImage() {
        image.style.display = 'none';
        image.removeAttribute('href');
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke-dasharray', '6,6');
    }

    // A freshly-picked (not yet committed) logo file wins over a filename
    // reference, since that path doesn't exist on GitHub yet to load from.
    const logoUploadInput = document.getElementById('logo-upload');
    const pickedFile = logoUploadInput && logoUploadInput.files[0];
    if (pickedFile) {
        const reader = new FileReader();
        reader.onload = () => showImage(reader.result);
        reader.readAsDataURL(pickedFile);
    } else if (obj.image) {
        showImage(`../${obj.image}`);
    } else {
        hideImage();
    }

    const titleEl = document.getElementById('preview-info-title');
    const bodyEl = document.getElementById('preview-info-body');
    if (titleEl) titleEl.textContent = obj.name || 'Your Organization';
    if (bodyEl) {
        let html = obj.description
            ? `<p>${escapeHtml(obj.description)}</p>`
            : `<p class="node-preview-placeholder">Fill in the fields to see a preview.</p>`;
        if (obj.impact) html += `<p><strong>Community Impact:</strong> ${escapeHtml(obj.impact)}</p>`;
        if (obj.links.length) {
            html += `<p><strong>Related Programs:</strong></p><div class="related-links">`;
            html += obj.links.map(l => `<a href="#">${escapeHtml(l.label || l.url)}</a>`).join('');
            html += `</div>`;
        }
        if (obj.website) {
            const shortUrl = obj.website.replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0];
            html += `<p><strong>Website:</strong> <a href="#">${escapeHtml(shortUrl)}</a></p>`;
        }
        bodyEl.innerHTML = html;
    }

    // Satellite nodes fanning outward for each related link — mirrors how
    // the real map's branchOutNode() draws them off a focused asset.
    const satGroup = document.getElementById('preview-satellites');
    if (satGroup) {
        while (satGroup.firstChild) satGroup.removeChild(satGroup.firstChild);
        const links = obj.links;
        if (links.length) {
            const CX = 140, CY = 140, RADIUS = 95, SAT_R = 14;
            const svgNS = 'http://www.w3.org/2000/svg';
            const baseAngle = -Math.PI / 2;
            const spreadDeg = links.length <= 1 ? 0 : Math.min(140, 40 + (links.length - 1) * 25);
            const spreadRad = spreadDeg * Math.PI / 180;
            links.forEach((l, i) => {
                const t = links.length === 1 ? 0 : (i / (links.length - 1)) - 0.5;
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

                const satCircle = document.createElementNS(svgNS, 'circle');
                satCircle.setAttribute('cx', sx); satCircle.setAttribute('cy', sy); satCircle.setAttribute('r', SAT_R);
                satCircle.setAttribute('fill', color); satCircle.setAttribute('fill-opacity', '0.3');
                satCircle.setAttribute('stroke', color); satCircle.setAttribute('stroke-width', '1.5');
                satGroup.appendChild(satCircle);

                const text = document.createElementNS(svgNS, 'text');
                text.setAttribute('x', sx); text.setAttribute('y', sy + SAT_R + 13);
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('fill', '#fff');
                text.setAttribute('font-size', '9');
                text.style.textShadow = '1px 1px 2px rgba(0,0,0,0.8)';
                text.textContent = truncateLabel(l.label || l.url, 11);
                satGroup.appendChild(text);
            });
        }
    }
}

// Full embedded map — same draft-injection mechanism the manual "Preview
// on Map" button always used, just callable on its own so it can also run
// automatically. Returns false (and hides the panel) if there's not yet
// enough to preview, so callers can skip scrolling to it.
function refreshMapPreview() {
    const nameField = document.getElementById('name');
    const idField = document.getElementById('id');
    const frame = document.getElementById('map-preview-frame');
    const frameCard = document.getElementById('map-preview-card');
    if (!nameField || !idField || !frame || !frameCard) return false;
    if (!nameField.value.trim()) { frameCard.hidden = true; return false; }

    const id = idField.value.trim() || slugify(nameField.value);
    sessionStorage.setItem('wf_preview_node', JSON.stringify({ id, data: buildNodeObject() }));
    frame.src = `../index.html?asset=${encodeURIComponent(id)}&preview=${encodeURIComponent(id)}`;
    frameCard.hidden = false;
    return true;
}

// The map preview is a real fetch + D3 force layout, not just a DOM
// update — reloading it on every keystroke would be janky, so field edits
// schedule it after a pause instead of running it immediately.
let mapPreviewDebounceTimer = null;
function scheduleMapPreviewUpdate() {
    clearTimeout(mapPreviewDebounceTimer);
    mapPreviewDebounceTimer = setTimeout(refreshMapPreview, 800);
}

function initNodeBuilderCore() {
    const nameField = document.getElementById('name');
    const idField = document.getElementById('id');

    initGithubTokenField();

    fetch('../content/assets.json')
        .then(r => r.json())
        .then(data => { existingIds = new Set(Object.keys(data)); checkIdCollision(); })
        .catch(err => console.error('node-builder: could not load assets.json', err));

    nameField.addEventListener('input', () => {
        if (!idManuallyEdited) {
            idField.value = slugify(nameField.value);
            checkIdCollision();
        }
    });

    idField.addEventListener('input', () => {
        idManuallyEdited = true;
        checkIdCollision();
    });

    document.getElementById('add-link-btn').addEventListener('click', () => addLinkRow());
    if (!document.querySelector('#links-container .link-row')) addLinkRow();

    document.getElementById('generate-btn').addEventListener('click', () => {
        const id = idField.value.trim() || slugify(nameField.value);
        const snippet = buildSnippet(id, buildNodeObject());
        document.getElementById('output').textContent = snippet;
        document.getElementById('output-card').hidden = false;
    });

    document.getElementById('copy-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('output').textContent);
    });

    // Manual "jump to it now" affordance — the map preview otherwise
    // updates automatically (see the delegated listener below), but this
    // forces an immediate refresh and scrolls it into view. Falls back to
    // a new tab on any page without the embedded iframe.
    const previewBtn = document.getElementById('preview-map-btn');
    if (previewBtn) {
        previewBtn.addEventListener('click', () => {
            if (!nameField.value.trim()) { alert('Enter a name first.'); return; }
            clearTimeout(mapPreviewDebounceTimer);
            const frameCard = document.getElementById('map-preview-card');
            if (frameCard) {
                refreshMapPreview();
                frameCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                const id = idField.value.trim() || slugify(nameField.value);
                sessionStorage.setItem('wf_preview_node', JSON.stringify({ id, data: buildNodeObject() }));
                window.open(`../index.html?asset=${encodeURIComponent(id)}&preview=${encodeURIComponent(id)}`, '_blank');
            }
        });
    }

    // Live preview panel + full map preview both stay in sync with every
    // field as it's typed — instant for the SVG mini-preview, debounced
    // for the map (a real fetch + force layout, too heavy to redo on every
    // keystroke). Delegated on the fields card so newly-added link rows
    // and the logo-upload file input are covered without wiring each one.
    const fieldsCard = document.querySelector('.card');
    if (fieldsCard) {
        fieldsCard.addEventListener('input', () => { updateBuilderPreview(); scheduleMapPreviewUpdate(); });
        fieldsCard.addEventListener('change', () => { updateBuilderPreview(); scheduleMapPreviewUpdate(); });
    }
    updateBuilderPreview();

    // Publishes straight to GitHub — only present on node-builder.html;
    // the Dashboard's equivalent action is its Mark Approved / Publish
    // Update button, which already covers the submission-review and
    // edit-existing-node paths.
    const publishBtn = document.getElementById('publish-new-btn');
    if (publishBtn) {
        publishBtn.addEventListener('click', async () => {
            const id = idField.value.trim() || slugify(nameField.value);
            const idWarningEl = document.getElementById('id-warning');
            const nodeObj = buildNodeObject();

            if (!id) { alert('Enter a name (or id) first.'); return; }
            if (!nodeObj.name) { alert('Name is required.'); return; }
            if (idWarningEl && !idWarningEl.hidden && !idField.disabled) {
                if (!confirm(`"${id}" is already used by an existing node. Continue anyway and REPLACE it?`)) return;
            }
            if (!confirm(`Publish "${nodeObj.name}" to the live map now? This commits directly to GitHub — the site will update within a minute or two.`)) return;

            const originalLabel = publishBtn.textContent;
            publishBtn.disabled = true;
            publishBtn.textContent = 'Publishing…';
            try {
                await publishNodeToGithub(id, nodeObj, 'Node Builder');
                existingIds.add(id);
                checkIdCollision();
                alert(`Published "${nodeObj.name}" to the live map.`);
            } catch (err) {
                console.error('publish failed', err);
                alert(`Publish failed: ${err.message}`);
            } finally {
                publishBtn.disabled = false;
                publishBtn.textContent = originalLabel;
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', initNodeBuilderCore);
