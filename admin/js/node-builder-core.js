/* ===== NODE BUILDER — CORE ===== */
/* Shared by admin/node-builder.html (standalone, hand-filled) and
   admin/dashboard.html (pre-filled from a parsed email submission via
   prefillBuilder()). Assumes the host page has the same field ids:
   name, id, category, tags, image, website, description, impact,
   links-container, add-link-btn, id-warning, generate-btn, output,
   output-card, copy-btn. entry-mode-note is optional (dashboard only). */

let existingIds = new Set();
let idManuallyEdited = false;

function slugify(text) {
    return text.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function checkIdCollision() {
    const idField = document.getElementById('id');
    const idWarning = document.getElementById('id-warning');
    const id = idField.value.trim();
    const collides = id && existingIds.has(id);
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
}

function initNodeBuilderCore() {
    const nameField = document.getElementById('name');
    const idField = document.getElementById('id');

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
}

document.addEventListener('DOMContentLoaded', initNodeBuilderCore);
