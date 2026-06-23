'use strict';

/*
 * Frontend logic. Security notes:
 * - All server data is rendered via textContent / input.value (never innerHTML),
 *   so document titles, usernames and content cannot inject HTML/JS (XSS-safe
 *   context-aware output handling on the client).
 * - Every state-changing request sends the per-session CSRF token in the
 *   X-CSRF-Token header and uses credentials so the session cookie is included.
 */

let csrfToken = null;
let currentUser = null;
let currentDoc = null;       // { id, title, permission }
let socket = null;
let editTimer = null;
let applyingRemote = false;

// ---- API helper ----------------------------------------------------------

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    const message = (data && data.error) || 'Request failed.';
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function refreshCsrf() {
  const data = await api('/api/csrf-token');
  csrfToken = data.csrfToken;
}

// ---- Element references ---------------------------------------------------

const el = (id) => document.getElementById(id);

const authView = el('authView');
const workspaceView = el('workspaceView');
const userbar = el('userbar');
const currentUserLabel = el('currentUser');

// ---- View switching ------------------------------------------------------

function showAuth() {
  authView.classList.remove('hidden');
  workspaceView.classList.add('hidden');
  userbar.classList.add('hidden');
}

function showWorkspace() {
  authView.classList.add('hidden');
  workspaceView.classList.remove('hidden');
  userbar.classList.remove('hidden');
  currentUserLabel.textContent = `Signed in as ${currentUser.username}`;
}

// ---- Auth ----------------------------------------------------------------

el('tabLogin').addEventListener('click', () => switchAuthTab('login'));
el('tabRegister').addEventListener('click', () => switchAuthTab('register'));

function switchAuthTab(which) {
  const login = which === 'login';
  el('tabLogin').classList.toggle('active', login);
  el('tabRegister').classList.toggle('active', !login);
  el('loginForm').classList.toggle('hidden', !login);
  el('registerForm').classList.toggle('hidden', login);
  el('authError').textContent = '';
}

el('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('authError').textContent = '';
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: {
        username: el('loginUsername').value,
        password: el('loginPassword').value,
      },
    });
    await refreshCsrf(); // token rotates with the new session
    currentUser = data.user;
    enterApp();
  } catch (err) {
    el('authError').textContent = err.message;
  }
});

el('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('authError').textContent = '';
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: {
        username: el('registerUsername').value,
        password: el('registerPassword').value,
      },
    });
    await refreshCsrf();
    currentUser = data.user;
    enterApp();
  } catch (err) {
    el('authError').textContent = err.message;
  }
});

el('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  if (socket) { socket.disconnect(); socket = null; }
  currentUser = null;
  currentDoc = null;
  await refreshCsrf();
  showAuth();
});

// ---- Documents -----------------------------------------------------------

el('newDocForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = el('newDocTitle').value.trim();
  if (!title) return;
  try {
    const data = await api('/api/documents', { method: 'POST', body: { title } });
    el('newDocTitle').value = '';
    await loadDocuments();
    openDocument(data.document.id);
  } catch (err) {
    alert(err.message);
  }
});

async function loadDocuments() {
  const data = await api('/api/documents');
  const list = el('docList');
  list.textContent = '';
  data.documents.forEach((doc) => {
    const li = document.createElement('li');
    li.dataset.id = String(doc.id);
    if (currentDoc && currentDoc.id === doc.id) li.classList.add('active');

    const name = document.createElement('div');
    name.className = 'doc-name';
    name.textContent = doc.title; // output-encoded

    const meta = document.createElement('div');
    meta.className = 'doc-meta';
    const role = doc.permission === 'owner' ? 'Owner' : `${cap(doc.permission)} access`;
    meta.textContent = `${role} · ${doc.owner_username}`;

    li.appendChild(name);
    li.appendChild(meta);
    li.addEventListener('click', () => openDocument(doc.id));
    list.appendChild(li);
  });
}

async function openDocument(id) {
  try {
    const data = await api(`/api/documents/${id}`);
    currentDoc = {
      id: data.document.id,
      title: data.document.title,
      permission: data.document.permission,
    };

    el('emptyState').classList.add('hidden');
    el('editorState').classList.remove('hidden');

    el('docTitle').textContent = data.document.title;

    const badge = el('permBadge');
    badge.textContent = currentDoc.permission;
    badge.className = `badge ${currentDoc.permission}`;

    const canEdit = currentDoc.permission === 'owner' || currentDoc.permission === 'edit';
    const isOwner = currentDoc.permission === 'owner';

    const textarea = el('docContent');
    applyingRemote = true;
    textarea.value = data.document.content;
    applyingRemote = false;
    textarea.disabled = !canEdit;

    el('deleteDocBtn').classList.toggle('hidden', !isOwner);
    el('inviteForm').classList.toggle('hidden', !isOwner);
    el('saveStatus').textContent = canEdit ? 'All changes saved.' : 'Read-only access.';

    await loadCollaborators(id, isOwner);
    joinRoom(id);
    highlightActive(id);
  } catch (err) {
    alert(err.message);
  }
}

function highlightActive(id) {
  document.querySelectorAll('#docList li').forEach((li) => {
    li.classList.toggle('active', li.dataset.id === String(id));
  });
}

el('docContent').addEventListener('input', () => {
  if (applyingRemote || !currentDoc) return;
  if (currentDoc.permission === 'view') return;
  el('saveStatus').textContent = 'Saving…';
  clearTimeout(editTimer);
  editTimer = setTimeout(persistContent, 400);
});

function persistContent() {
  if (!currentDoc || !socket) return;
  const content = el('docContent').value;
  // Real-time path: broadcast + persist via socket.
  socket.emit('edit', { documentId: currentDoc.id, content });
  el('saveStatus').textContent = 'All changes saved.';
}

el('deleteDocBtn').addEventListener('click', async () => {
  if (!currentDoc) return;
  if (!confirm('Delete this document for everyone? This cannot be undone.')) return;
  try {
    await api(`/api/documents/${currentDoc.id}`, { method: 'DELETE' });
    currentDoc = null;
    el('editorState').classList.add('hidden');
    el('emptyState').classList.remove('hidden');
    await loadDocuments();
  } catch (err) {
    alert(err.message);
  }
});

// ---- Collaborators -------------------------------------------------------

async function loadCollaborators(id, isOwner) {
  const data = await api(`/api/documents/${id}/collaborators`);
  const list = el('collabList');
  list.textContent = '';
  el('collabError').textContent = '';

  const rows = [];
  if (data.owner) rows.push({ ...data.owner, isOwner: true });
  data.collaborators.forEach((c) => rows.push({ ...c, isOwner: false }));

  rows.forEach((row) => {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'cname';
    name.textContent = row.username; // output-encoded
    li.appendChild(name);

    const badge = document.createElement('span');
    badge.className = `badge ${row.permission}`;
    badge.textContent = row.permission;
    li.appendChild(badge);

    const grow = document.createElement('span');
    grow.className = 'grow';
    li.appendChild(grow);

    if (isOwner && !row.isOwner) {
      const sel = document.createElement('select');
      ['view', 'edit'].forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p === 'view' ? 'Can view' : 'Can edit';
        if (p === row.permission) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => changePermission(id, row.user_id, sel.value));
      li.appendChild(sel);

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'danger';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => removeCollaborator(id, row.user_id));
      li.appendChild(rm);
    }

    list.appendChild(li);
  });
}

el('inviteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentDoc) return;
  el('collabError').textContent = '';
  try {
    await api(`/api/documents/${currentDoc.id}/collaborators`, {
      method: 'POST',
      body: {
        username: el('inviteUsername').value.trim(),
        permission: el('invitePermission').value,
      },
    });
    el('inviteUsername').value = '';
    await loadCollaborators(currentDoc.id, true);
  } catch (err) {
    el('collabError').textContent = err.message;
  }
});

async function changePermission(docId, userId, permission) {
  try {
    await api(`/api/documents/${docId}/collaborators/${userId}`, {
      method: 'PUT',
      body: { permission },
    });
    await loadCollaborators(docId, true);
  } catch (err) {
    el('collabError').textContent = err.message;
  }
}

async function removeCollaborator(docId, userId) {
  try {
    await api(`/api/documents/${docId}/collaborators/${userId}`, { method: 'DELETE' });
    await loadCollaborators(docId, true);
  } catch (err) {
    el('collabError').textContent = err.message;
  }
}

// ---- Real-time -----------------------------------------------------------

function ensureSocket() {
  if (socket) return;
  socket = io({ withCredentials: true });
  socket.on('document-updated', (payload) => {
    if (!currentDoc || payload.documentId !== currentDoc.id) return;
    const textarea = el('docContent');
    // Preserve caret position as best we can for a textarea.
    const pos = textarea.selectionStart;
    applyingRemote = true;
    textarea.value = payload.content;
    applyingRemote = false;
    try { textarea.setSelectionRange(pos, pos); } catch (_) {}
    el('saveStatus').textContent = 'Updated by a collaborator.';
  });
}

function joinRoom(id) {
  ensureSocket();
  socket.emit('join', id);
}

// ---- Bootstrap -----------------------------------------------------------

async function enterApp() {
  showWorkspace();
  ensureSocket();
  await loadDocuments();
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

async function init() {
  await refreshCsrf();
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    await enterApp();
  } catch (_) {
    showAuth();
  }
}

init();
