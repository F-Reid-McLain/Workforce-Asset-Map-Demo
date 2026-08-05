/* ===== SUBMISSIONS DASHBOARD ===== */
/* Pulls "Workforce Map Submissions" directly from Outlook via Microsoft
   Graph (MSAL.js SPA/PKCE flow — no client secret, since this is
   client-side code even though it only ever runs locally). Approve opens
   the shared node-builder view (js/node-builder-core.js) pre-filled from
   the parsed email; Decline/Mark Approved move the source message into
   the Declined/Processed subfolders via Graph. */

// Entra ID app registration: "Workforce Map Submissions Dashboard".
// clientId/authority aren't secrets — this is a public client (SPA/PKCE),
// safe to commit, same as the Formspree endpoint elsewhere in the repo.
const MSAL_CONFIG = {
    auth: {
        clientId: '54031876-203a-4adf-8e25-692794baa8fe',
        authority: 'https://login.microsoftonline.com/77a929d8-25c0-482f-af2f-e22ff69c8e48',
        redirectUri: window.location.origin + window.location.pathname
    },
    cache: { cacheLocation: 'localStorage' }
};

const GRAPH_SCOPES = ['Mail.ReadWrite', 'offline_access'];
const SUBMISSIONS_FOLDER_NAME = 'Workforce Map Submissions';
const PROCESSED_FOLDER_NAME = 'Processed';
const DECLINED_FOLDER_NAME = 'Declined';

/* ----- Publish to GitHub -----
   getGithubToken/githubFetch/publishNodeToGithub/the GITHUB_* constants and
   the token input's wiring all moved to node-builder-core.js (loaded before
   this file) so node-builder.html can publish too, not just this Dashboard —
   see that file for the full explanation of the token/credential model. */

// Reads a picked file as raw base64 (GitHub's Contents API wants raw
// base64 bytes for binary files, same param it uses for text — no data:
// URL prefix, so that gets stripped off FileReader's result here).
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

// A 404 here just means "no file at this path yet" (a brand new logo), not
// an error — so this bypasses githubFetch's throw-on-any-!ok behavior and
// tolerates that one status specifically.
async function getExistingFileSha(path) {
    const token = getGithubToken();
    if (!token) throw new Error('No GitHub token set — paste one into the field above and click Save.');
    const response = await fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API error ${response.status}: ${await response.text().catch(() => '')}`);
    return (await response.json()).sha;
}

// Uploads the picked logo file to assets/logos/<filename> and returns the
// filename actually used, for the caller to fold into the node's `image`
// field. Runs before publishNodeToGithub so a failed upload never leaves
// assets.json pointing at an image that was never actually committed.
async function publishLogoUpload(file) {
    const typedName = document.getElementById('image').value.trim();
    const filename = typedName || file.name;
    const path = `assets/logos/${filename}`;

    const existingSha = await getExistingFileSha(path);
    if (existingSha && !confirm(`"${filename}" already exists in assets/logos/ — uploading will overwrite it. Continue?`)) {
        throw new Error('Logo upload cancelled.');
    }

    const base64 = await readFileAsBase64(file);
    await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: `Add logo "${filename}" via Submissions Dashboard`,
            content: base64,
            branch: GITHUB_BRANCH,
            ...(existingSha ? { sha: existingSha } : {})
        })
    });
    return filename;
}

let msalInstance;
let account = null;
let folderIds = {};
let currentMessages = [];
let currentSubmission = null; // the message being approved, while in builder view
// Which view Mark Approved / the back button return to — 'list-view' when
// builder-view was opened from a real email (approveSubmission), 'manage-view'
// when opened by editing an existing live node directly (editExistingNode).
let builderReturnView = 'list-view';
// escapeHtml is provided by node-builder-core.js, loaded before this file.

// Shows exactly one of the four top-level views, hiding the rest — used by
// every nav button so chaining between them (e.g. Activity Log straight to
// Manage Existing Nodes) can never leave two views visible at once.
const TOP_LEVEL_VIEWS = ['list-view', 'manage-view', 'activity-view', 'builder-view'];
function showView(id) {
    TOP_LEVEL_VIEWS.forEach(v => { document.getElementById(v).hidden = (v !== id); });
}

/* ----- Auth ----- */
async function initMsal() {
    msalInstance = new msal.PublicClientApplication(MSAL_CONFIG);
    await msalInstance.initialize();

    const result = await msalInstance.handleRedirectPromise().catch(err => {
        console.error('MSAL redirect handling failed', err);
        return null;
    });
    if (result) account = result.account;
    else {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length) account = accounts[0];
    }

    updateAuthUI();
    if (account) loadSubmissions();

    document.getElementById('sign-in-btn').addEventListener('click', () => {
        msalInstance.loginRedirect({ scopes: GRAPH_SCOPES });
    });
}

function updateAuthUI() {
    document.getElementById('sign-in-btn').hidden = !!account;
    const signedInEl = document.getElementById('signed-in-as');
    signedInEl.hidden = !account;
    if (account) signedInEl.textContent = `Signed in as ${account.username}`;
}

async function getGraphToken() {
    try {
        const result = await msalInstance.acquireTokenSilent({ scopes: GRAPH_SCOPES, account });
        return result.accessToken;
    } catch (err) {
        // Silent refresh failed (expired session, revoked consent, etc.) —
        // fall back to an interactive prompt rather than leaving the
        // dashboard stuck.
        await msalInstance.acquireTokenRedirect({ scopes: GRAPH_SCOPES, account });
        return null; // redirect navigates away; nothing after this runs
    }
}

async function graphFetch(path, options = {}) {
    const token = await getGraphToken();
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Graph API error ${response.status}: ${await response.text()}`);
    return response.status === 204 ? null : response.json();
}

/* ----- Folders & messages ----- */
async function findFolderId(displayName) {
    const data = await graphFetch('/me/mailFolders?$top=100');
    const match = data.value.find(f => f.displayName === displayName);
    if (!match) throw new Error(`Folder "${displayName}" not found — check it exists in Outlook exactly as named.`);
    return match.id;
}

async function ensureFolders() {
    if (folderIds.submissions) return;
    folderIds.submissions = await findFolderId(SUBMISSIONS_FOLDER_NAME);
    folderIds.processed = await findFolderId(PROCESSED_FOLDER_NAME);
    folderIds.declined = await findFolderId(DECLINED_FOLDER_NAME);
}

async function loadSubmissions() {
    const listEl = document.getElementById('submissions-list');
    listEl.innerHTML = '<p class="dash-empty">Loading…</p>';
    try {
        await ensureFolders();
        const data = await graphFetch(
            `/me/mailFolders/${folderIds.submissions}/messages?$select=subject,from,receivedDateTime,body,bodyPreview,hasAttachments&$orderby=receivedDateTime desc&$top=50`
        );
        currentMessages = data.value;
        renderSubmissions();
    } catch (err) {
        console.error(err);
        listEl.innerHTML = `<p class="dash-empty">Couldn't load submissions: ${escapeHtml(err.message)}</p>`;
    }
}

function renderSubmissions() {
    const listEl = document.getElementById('submissions-list');
    if (!currentMessages.length) {
        listEl.innerHTML = '<p class="dash-empty">Nothing pending.</p>';
        return;
    }
    listEl.innerHTML = currentMessages.map((m, i) => `
        <div class="dash-card">
            <div class="dash-card-subject">${escapeHtml((m.subject || '').replace('[WF Map Submission] ', ''))}</div>
            <div class="dash-card-meta">${escapeHtml(m.from?.emailAddress?.address)} — ${new Date(m.receivedDateTime).toLocaleString()}</div>
            <div class="dash-card-preview">${escapeHtml((m.bodyPreview || '').slice(0, 160))}</div>
            <div class="dash-card-actions">
                <button type="button" class="approve-btn" data-index="${i}">View</button>
            </div>
        </div>
    `).join('');

    // Approve/Decline both live inside the detail view now (viewSubmission),
    // reached by View — reviewing before deciding, rather than deciding
    // straight from the list.
    listEl.querySelectorAll('.approve-btn').forEach(btn =>
        btn.addEventListener('click', () => viewSubmission(currentMessages[+btn.dataset.index])));
}

async function declineSubmission(message) {
    if (!confirm(`Decline "${message.subject}"? This moves the email to the Declined folder.`)) return;
    await graphFetch(`/me/messages/${message.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationId: folderIds.declined })
    });
    showView('list-view');
    currentSubmission = null;
    loadSubmissions();
}

/* ----- Parsing a submission out of the email body ----- */
/* Reads message.body.content (HTML) by the exact field `name` attributes
   js/forms.js submits. Validated against a real fetched Formspree
   notification: there is no "label: value" text anywhere — each field is a
   <p><span style="color:#999999">field_name</span></p> immediately
   followed by a SEPARATE sibling <span> holding the value, both direct
   children of the same wrapping div.txtTinyMce-wrapper. (An earlier version
   of this function looked for a colon-separated "label: value" string,
   which doesn't exist in Formspree's actual template and left every field
   blank — this was caught by testing against real submissions.) */
function parseSubmission(message) {
    const isEdit = /Edit Request:/i.test(message.subject || '');
    const doc = new DOMParser().parseFromString(message.body?.content || '', 'text/html');

    const fieldMap = {};
    Array.from(doc.querySelectorAll('span')).forEach(labelSpan => {
        // Formspree renders each field's label in a span explicitly colored
        // #999999 — that's the only reliable marker, since the label text
        // itself is just the raw field name with no colon or wrapper class.
        if (!/#999999/i.test(labelSpan.getAttribute('style') || '')) return;
        const label = labelSpan.textContent.trim().toLowerCase();
        if (!label || label in fieldMap) return;

        const wrapper = labelSpan.closest('.txtTinyMce-wrapper');
        if (!wrapper) return;
        // The value lives in a <span> that's a direct child of the same
        // wrapper — a sibling of the <p> the label is nested in, not
        // inside that <p> itself.
        const valueSpan = Array.from(wrapper.children).find(child => child.tagName === 'SPAN');
        fieldMap[label] = valueSpan ? valueSpan.textContent.trim() : '';
    });

    function field(name) {
        const key = name.toLowerCase();
        if (key in fieldMap) return fieldMap[key];
        const humanized = key.replace(/_/g, ' '); // in case Formspree humanizes labels (e.g. "Asset Name")
        return fieldMap[humanized] || '';
    }

    function programs() {
        const links = [];
        for (let i = 1; i <= 20; i++) {
            const label = field(`program_${i}_name`);
            if (!label) continue;
            links.push({ label, url: field(`program_${i}_url`), description: field(`program_${i}_description`) });
        }
        return links;
    }

    if (isEdit) {
        return {
            name: field('edited_name') || field('node_name'),
            website: field('edited_website'),
            description: field('edited_description'),
            impact: field('edited_impact'),
            links: programs(),
            lockId: field('node_id'),
            logoUrl: ''
        };
    }

    return {
        name: field('asset_name'),
        category: field('category'),
        tags: field('tags').split(',').map(t => t.trim()).filter(Boolean),
        website: field('website'),
        description: field('description'),
        impact: field('impact'),
        links: programs(),
        logoUrl: field('logo_url')
    };
}

// Edit-request submissions only carry the fields the requester actually
// touched (name/description/impact/website/programs) — category, tags,
// and image aren't editable there at all, so fill those in from the
// node's real current entry rather than leaving them blank/defaulted.
async function mergeExistingNodeData(fields) {
    if (!fields.lockId) return fields;
    try {
        const assetsData = await fetch('../content/assets.json').then(r => r.json());
        const existing = assetsData[fields.lockId];
        if (existing) {
            fields.category = existing.category || '';
            fields.tags = existing.tags || [];
            fields.image = existing.image ? existing.image.replace(/^assets\/logos\//, '') : '';
        }
    } catch (err) {
        console.error('dashboard: could not load content/assets.json to merge existing node data', err);
    }
    return fields;
}

async function renderAttachments(message) {
    const row = document.getElementById('attachments-row');
    row.innerHTML = '';
    if (!message.hasAttachments) return;
    try {
        const data = await graphFetch(`/me/messages/${message.id}/attachments`);
        data.value.forEach(att => {
            if (!att.contentBytes) return; // skip anything not inline-downloadable
            const link = document.createElement('a');
            link.href = `data:${att.contentType};base64,${att.contentBytes}`;
            link.download = att.name;
            link.textContent = `Download: ${att.name}`;
            row.appendChild(link);
        });
    } catch (err) {
        console.error('dashboard: could not list attachments', err);
    }
}

// List's "View" button — shows the submission's full parsed details in the
// builder view, with nothing decided yet. Approve (Mark Approved) and
// Decline both live here as explicit next steps, rather than deciding
// straight off the list preview snippet.
async function viewSubmission(message) {
    currentSubmission = message;
    builderReturnView = 'list-view';
    document.getElementById('mark-approved-btn').textContent = 'Mark Approved (moves email)';
    document.getElementById('decline-in-builder-btn').hidden = false;
    let fields = parseSubmission(message);
    fields = await mergeExistingNodeData(fields);

    showView('builder-view');
    prefillBuilder(fields);
    renderAttachments(message);

    if (fields.logoUrl) {
        const row = document.getElementById('attachments-row');
        const note = document.createElement('div');
        note.className = 'hint';
        note.textContent = `Submitter provided a logo link instead of a file: ${fields.logoUrl}`;
        row.appendChild(note);
    }
}

// Manage Existing Nodes' "Edit" button — same builder view as viewing a
// submission, just pre-filled straight from the live node instead of a
// parsed email, and with no email behind it to decline or move.
function editExistingNode(node) {
    currentSubmission = null;
    builderReturnView = 'manage-view';
    document.getElementById('mark-approved-btn').textContent = 'Publish Update';
    document.getElementById('decline-in-builder-btn').hidden = true;
    document.getElementById('attachments-row').innerHTML = '';

    showView('builder-view');
    prefillBuilder({
        name: node.name || '',
        category: node.category || '',
        tags: node.tags || [],
        image: node.image ? node.image.replace(/^assets\/logos\//, '') : '',
        website: node.website || '',
        description: node.description || '',
        impact: node.impact || '',
        links: node.links || [],
        lockId: node.id
    });
}

document.getElementById('back-to-list-btn').addEventListener('click', () => {
    showView(builderReturnView);
    if (builderReturnView === 'manage-view') loadManageableNodes();
    currentSubmission = null;
});

// Only shown when viewing a real submission (viewSubmission sets it
// visible, editExistingNode hides it — declining doesn't apply to editing
// an already-live node). Reuses declineSubmission, which itself now leaves
// the builder view once the move succeeds.
document.getElementById('decline-in-builder-btn').addEventListener('click', () => {
    if (currentSubmission) declineSubmission(currentSubmission);
});

document.getElementById('mark-approved-btn').addEventListener('click', async () => {
    const idField = document.getElementById('id');
    const id = idField.value.trim();
    const idWarning = document.getElementById('id-warning');
    const nodeObj = buildNodeObject();
    const logoFile = document.getElementById('logo-upload').files[0];

    if (!id) { alert('Enter an id first.'); return; }
    if (!nodeObj.name) { alert('Name is required.'); return; }
    // idField is disabled only for the intentional "replace this existing
    // node" edit-request path (see prefillBuilder's fields.lockId branch) —
    // a visible collision on an otherwise-editable id means this would
    // silently overwrite some other, unrelated node.
    if (idWarning && !idWarning.hidden && !idField.disabled) {
        if (!confirm(`"${id}" is already used by an existing node. Continue anyway and REPLACE it?`)) return;
    }
    const publishVerb = currentSubmission ? 'Publish' : 'Publish the update to';
    if (!confirm(`${publishVerb} "${nodeObj.name}" on the live map now? This commits directly to GitHub — the site will update within a minute or two.`)) return;

    const btn = document.getElementById('mark-approved-btn');
    const originalLabel = btn.textContent;
    btn.disabled = true;

    try {
        if (logoFile) {
            btn.textContent = 'Uploading logo…';
            const logoFilename = await publishLogoUpload(logoFile);
            nodeObj.image = `assets/logos/${logoFilename}`;
        }

        btn.textContent = 'Publishing…';
        await publishNodeToGithub(id, nodeObj);

        if (currentSubmission) {
            await graphFetch(`/me/messages/${currentSubmission.id}/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ destinationId: folderIds.processed })
            });
        }

        showView(builderReturnView);
        currentSubmission = null;
        if (builderReturnView === 'manage-view') loadManageableNodes();
        else loadSubmissions();
    } catch (err) {
        console.error('publish failed', err);
        const emailNote = currentSubmission
            ? '\n\nThe email was left in place — nothing was moved, and no email will be re-sent, so it\'s safe to just try again.'
            : '';
        alert(`Publish failed: ${err.message}${emailNote}`);
    } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
    }
});

/* ----- Manage Existing Nodes — prune published entries ----- */
/* Reads content/assets.json the same way node-builder-core.js does for
   collision-checking (no GitHub token needed just to list); removing one
   goes through the GitHub API same as publishing does, since that's the
   only thing that actually needs write access. */
let manageableNodes = [];

async function loadManageableNodes() {
    const listEl = document.getElementById('manage-list');
    listEl.innerHTML = '<p class="dash-empty">Loading…</p>';
    try {
        const data = await fetch('../content/assets.json').then(r => r.json());
        manageableNodes = Object.entries(data).map(([id, d]) => ({ id, ...d }));
        renderManageableNodes(manageableNodes);
    } catch (err) {
        console.error('manage: could not load assets.json', err);
        listEl.innerHTML = `<p class="dash-empty">Couldn't load nodes: ${escapeHtml(err.message)}</p>`;
    }
}

function renderManageableNodes(nodes) {
    const listEl = document.getElementById('manage-list');
    if (!nodes.length) {
        listEl.innerHTML = '<p class="dash-empty">No matches.</p>';
        return;
    }
    listEl.innerHTML = nodes.map(n => `
        <div class="dash-card">
            <div class="dash-card-subject">${escapeHtml(n.name || n.id)}</div>
            <div class="dash-card-meta">${escapeHtml(n.category || '')} — id: ${escapeHtml(n.id)}</div>
            <div class="dash-card-actions">
                <button type="button" class="approve-btn" data-id="${escapeHtml(n.id)}">Edit</button>
                <button type="button" class="decline-btn" data-id="${escapeHtml(n.id)}">Remove from map</button>
            </div>
        </div>
    `).join('');

    listEl.querySelectorAll('.approve-btn').forEach(btn =>
        btn.addEventListener('click', () => {
            const node = manageableNodes.find(n => n.id === btn.dataset.id);
            if (node) editExistingNode(node);
        }));
    listEl.querySelectorAll('.decline-btn').forEach(btn =>
        btn.addEventListener('click', () => {
            const node = manageableNodes.find(n => n.id === btn.dataset.id);
            if (node) removeManagedNode(node);
        }));
}

async function removeManagedNode(node) {
    if (!confirm(`Remove "${node.name || node.id}" from the live map? This commits directly to GitHub — the site will update within a minute or two. (Still recoverable from GitHub's commit history, just not from here.)`)) return;
    try {
        await deleteNodeFromGithub(node.id, node.name || node.id);
        loadManageableNodes();
    } catch (err) {
        console.error('remove failed', err);
        alert(`Removal failed: ${err.message}`);
    }
}

async function deleteNodeFromGithub(id, name) {
    const file = await githubFetch(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_ASSETS_PATH}?ref=${GITHUB_BRANCH}`
    );
    const assets = JSON.parse(base64ToUtf8(file.content.replace(/\n/g, '')));
    if (!(id in assets)) throw new Error(`"${id}" is already gone from the live file — someone else may have removed it. Reload the list.`);
    delete assets[id];

    const newContent = JSON.stringify(assets, null, 2) + '\n';

    await githubFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_ASSETS_PATH}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: `Remove "${name}" via Submissions Dashboard`,
            content: utf8ToBase64(newContent),
            sha: file.sha,
            branch: GITHUB_BRANCH
        })
    });
}

document.getElementById('manage-nodes-btn').addEventListener('click', () => {
    showView('manage-view');
    loadManageableNodes();
});

document.getElementById('manage-back-btn').addEventListener('click', () => {
    showView('list-view');
});

document.getElementById('manage-search').addEventListener('input', function () {
    const q = this.value.trim().toLowerCase();
    renderManageableNodes(
        q ? manageableNodes.filter(n => (n.name || '').toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) : manageableNodes
    );
});

/* ----- Activity Log — recent changes made through this Dashboard ----- */
/* Read-only against GitHub's commits API, scoped to the assets file so it's
   just publishes/edits/removals, not every commit in the repo's history. */
async function loadActivityLog() {
    const listEl = document.getElementById('activity-list');
    listEl.innerHTML = '<p class="dash-empty">Loading…</p>';
    try {
        const commits = await githubFetch(
            `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits?path=${GITHUB_ASSETS_PATH}&per_page=30`
        );
        renderActivityLog(commits);
    } catch (err) {
        console.error('activity: could not load commits', err);
        listEl.innerHTML = `<p class="dash-empty">Couldn't load activity: ${escapeHtml(err.message)}</p>`;
    }
}

function renderActivityLog(commits) {
    const listEl = document.getElementById('activity-list');
    if (!commits.length) {
        listEl.innerHTML = '<p class="dash-empty">No changes yet.</p>';
        return;
    }
    listEl.innerHTML = commits.map(c => `
        <div class="dash-card">
            <div class="dash-card-subject">${escapeHtml(c.commit.message.split('\n')[0])}</div>
            <div class="dash-card-meta">${escapeHtml(c.commit.author.name)} — ${new Date(c.commit.author.date).toLocaleString()}</div>
            <div class="dash-card-actions">
                <a href="${c.html_url}" target="_blank" rel="noopener" class="back-btn" style="text-decoration: none; display: inline-block;">View on GitHub</a>
            </div>
        </div>
    `).join('');
}

document.getElementById('activity-log-btn').addEventListener('click', () => {
    showView('activity-view');
    loadActivityLog();
});

document.getElementById('activity-back-btn').addEventListener('click', () => {
    showView('list-view');
});

// Embedded map preview's "Close preview" button (viz-engine.js) can't call
// window.close() on itself from inside an iframe — it posts here instead.
window.addEventListener('message', (event) => {
    if (event.data === 'wf-preview-close') {
        document.getElementById('map-preview-card').hidden = true;
        document.getElementById('map-preview-frame').src = 'about:blank';
    }
});

document.addEventListener('DOMContentLoaded', () => {
    initMsal();
});
