/* ===== SUBMISSIONS DASHBOARD ===== */
/* Pulls "Workforce Map Submissions" directly from Outlook via Microsoft
   Graph (MSAL.js SPA/PKCE flow — no client secret, since this is
   client-side code even though it only ever runs locally). Approve opens
   the shared node-builder view (js/node-builder-core.js) pre-filled from
   the parsed email; Decline/Mark Approved move the source message into
   the Declined/Processed subfolders via Graph. */

// Filled in once the Entra ID app registration is done (see the setup
// request) — no secret needed, just these two IDs.
const MSAL_CONFIG = {
    auth: {
        clientId: 'AZURE_APP_CLIENT_ID_PLACEHOLDER',
        authority: 'https://login.microsoftonline.com/AZURE_TENANT_ID_PLACEHOLDER',
        redirectUri: window.location.origin + window.location.pathname
    },
    cache: { cacheLocation: 'localStorage' }
};

const GRAPH_SCOPES = ['Mail.ReadWrite', 'offline_access'];
const SUBMISSIONS_FOLDER_NAME = 'Workforce Map Submissions';
const PROCESSED_FOLDER_NAME = 'Processed';
const DECLINED_FOLDER_NAME = 'Declined';

let msalInstance;
let account = null;
let folderIds = {};
let currentMessages = [];
let currentSubmission = null; // the message being approved, while in builder view

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
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
                <button type="button" class="approve-btn" data-index="${i}">Approve</button>
                <button type="button" class="decline-btn" data-index="${i}">Decline</button>
            </div>
        </div>
    `).join('');

    listEl.querySelectorAll('.approve-btn').forEach(btn =>
        btn.addEventListener('click', () => approveSubmission(currentMessages[+btn.dataset.index])));
    listEl.querySelectorAll('.decline-btn').forEach(btn =>
        btn.addEventListener('click', () => declineSubmission(currentMessages[+btn.dataset.index])));
}

async function declineSubmission(message) {
    if (!confirm(`Decline "${message.subject}"? This moves the email to the Declined folder.`)) return;
    await graphFetch(`/me/messages/${message.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationId: folderIds.declined })
    });
    loadSubmissions();
}

/* ----- Parsing a submission out of the email body ----- */
/* Reads message.body.content (HTML) by the exact field `name` attributes
   js/forms.js submits — not by guessing Formspree's own display labels.
   NOT YET VALIDATED against a real fetched message; the matching below is
   a best-effort first pass and will likely need adjusting once we can see
   the actual HTML Formspree sends (there are real test submissions
   already sitting in the folder to check this against). Any field that
   doesn't match just comes through blank — the builder form stays fully
   editable, so that degrades to "fill in one field by hand," not a
   blocker. */
function parseSubmission(message) {
    const isEdit = /Edit Request:/i.test(message.subject || '');
    const doc = new DOMParser().parseFromString(message.body?.content || '', 'text/html');

    // Build a label->value map from the smallest ("leaf") block elements
    // that look like a "label: value" row — walking the DOM structurally
    // like this, one element at a time, avoids the bug a flat regex over
    // doc.body.textContent has: browsers don't insert line breaks between
    // block elements in .textContent, so every field's text just runs
    // together on one "line" and a global regex over-matches across rows.
    const BLOCK_SELECTOR = 'p, li, td, div';
    const fieldMap = {};
    Array.from(doc.querySelectorAll(BLOCK_SELECTOR)).forEach(el => {
        if (el.querySelector(BLOCK_SELECTOR)) return; // not a leaf row — skip the wrapper
        const t = el.textContent.replace(/\s+/g, ' ').trim();
        const colonIdx = t.indexOf(':');
        if (colonIdx <= 0 || colonIdx > 60) return; // labels are short; long "colon" hits are false positives
        const label = t.slice(0, colonIdx).trim().toLowerCase();
        const value = t.slice(colonIdx + 1).trim();
        if (label && value && !(label in fieldMap)) fieldMap[label] = value;
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

async function approveSubmission(message) {
    currentSubmission = message;
    let fields = parseSubmission(message);
    fields = await mergeExistingNodeData(fields);

    document.getElementById('list-view').hidden = true;
    document.getElementById('builder-view').hidden = false;
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

document.getElementById('back-to-list-btn').addEventListener('click', () => {
    document.getElementById('builder-view').hidden = true;
    document.getElementById('list-view').hidden = false;
    currentSubmission = null;
});

document.getElementById('mark-approved-btn').addEventListener('click', async () => {
    if (!currentSubmission) return;
    if (!confirm("Mark this approved and move the email to Processed? Only do this after you've copied the JSON and updated content/assets.json.")) return;
    await graphFetch(`/me/messages/${currentSubmission.id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationId: folderIds.processed })
    });
    document.getElementById('builder-view').hidden = true;
    document.getElementById('list-view').hidden = false;
    currentSubmission = null;
    loadSubmissions();
});

document.addEventListener('DOMContentLoaded', initMsal);
