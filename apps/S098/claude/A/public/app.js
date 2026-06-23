'use strict';

const $ = (id) => document.getElementById(id);
const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

let me = null;
let currentDoc = null; // { id, title, role }
let socket = null;
let saveTimer = null;
let applyingRemote = false; // guard so remote updates don't echo back

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function refreshMe() {
  const { user } = await api('/api/me');
  me = user;
  if (me) {
    $('auth').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('userbar').classList.remove('hidden');
    $('who').textContent = `Signed in as ${me.username}`;
    connectSocket();
    loadDocuments();
  } else {
    $('auth').classList.remove('hidden');
    $('app').classList.add('hidden');
    $('userbar').classList.add('hidden');
  }
}

async function doAuth(endpoint) {
  $('auth-error').textContent = '';
  try {
    await api(endpoint, {
      method: 'POST',
      body: JSON.stringify({ username: $('username').value, password: $('password').value }),
    });
    await refreshMe();
  } catch (e) {
    $('auth-error').textContent = e.message;
  }
}

$('login').onclick = () => doAuth('/api/login');
$('register').onclick = () => doAuth('/api/register');
$('logout').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  currentDoc = null;
  if (socket) socket.disconnect();
  await refreshMe();
};

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

function connectSocket() {
  if (socket) return;
  socket = io();
  socket.on('doc-update', ({ content }) => {
    if (!currentDoc) return;
    applyingRemote = true;
    const el = $('content');
    const pos = el.selectionStart;
    el.value = content;
    el.setSelectionRange(pos, pos);
    applyingRemote = false;
  });
  socket.on('access-changed', ({ access, removedUserId }) => {
    if (!currentDoc) return;
    if (removedUserId && removedUserId === me.id) {
      // We just lost access to the doc we're viewing.
      $('status').textContent = 'Your access to this document was removed.';
      closeDoc();
      loadDocuments();
      return;
    }
    renderAccess(access);
  });
  socket.on('error-msg', (msg) => { $('status').textContent = msg; });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

async function loadDocuments() {
  const { documents } = await api('/api/documents');
  const list = $('doc-list');
  list.innerHTML = '';
  if (!documents.length) {
    list.innerHTML = '<li class="muted">No documents yet.</li>';
  }
  for (const d of documents) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(d.title)}</span>
      <span class="muted">${d.role}${d.role !== 'owner' ? ` · ${escapeHtml(d.owner)}` : ''}</span>`;
    li.onclick = () => openDoc(d.id);
    if (currentDoc && currentDoc.id === d.id) li.classList.add('active');
    list.appendChild(li);
  }
}

$('new-doc').onclick = async () => {
  const title = prompt('Document title:', 'Untitled');
  if (title === null) return;
  const doc = await api('/api/documents', { method: 'POST', body: JSON.stringify({ title }) });
  await loadDocuments();
  openDoc(doc.id);
};

async function openDoc(id) {
  const { document: doc, role, access } = await api(`/api/documents/${id}`);
  currentDoc = { id: doc.id, title: doc.title, role };

  $('empty-pane').classList.add('hidden');
  $('editor-pane').classList.remove('hidden');
  $('doc-title').textContent = doc.title;
  $('role-badge').textContent = role;

  const editable = role === 'owner' || role === 'edit';
  const ta = $('content');
  ta.value = doc.content;
  ta.disabled = !editable;
  $('status').textContent = editable ? '' : 'View-only access';

  $('invite-box').classList.toggle('hidden', role !== 'owner');
  renderAccess(access);

  socket.emit('join', id);
  loadDocuments(); // refresh active highlight
}

function closeDoc() {
  currentDoc = null;
  $('editor-pane').classList.add('hidden');
  $('empty-pane').classList.remove('hidden');
}

$('content').addEventListener('input', () => {
  if (applyingRemote || !currentDoc) return;
  if (currentDoc.role === 'view') return;
  clearTimeout(saveTimer);
  $('status').textContent = 'Saving…';
  saveTimer = setTimeout(() => {
    socket.emit('edit', { docId: currentDoc.id, content: $('content').value });
    $('status').textContent = 'Saved';
  }, 250);
});

// ---------------------------------------------------------------------------
// Access list / invitations
// ---------------------------------------------------------------------------

function renderAccess(access) {
  const ul = $('access-list');
  ul.innerHTML = '';
  const isOwner = currentDoc && currentDoc.role === 'owner';
  for (const a of access) {
    const li = document.createElement('li');
    const label = `${escapeHtml(a.username)} — ${a.role}`;
    li.innerHTML = `<span>${label}</span>`;
    if (isOwner && a.role !== 'owner') {
      const btn = document.createElement('button');
      btn.textContent = 'Remove';
      btn.className = 'small danger';
      btn.onclick = () => removeCollaborator(a.user_id);
      li.appendChild(btn);
    }
    ul.appendChild(li);
  }
}

$('invite').onclick = async () => {
  $('invite-error').textContent = '';
  try {
    const { access } = await api(`/api/documents/${currentDoc.id}/collaborators`, {
      method: 'POST',
      body: JSON.stringify({
        username: $('invite-username').value,
        role: $('invite-role').value,
      }),
    });
    $('invite-username').value = '';
    renderAccess(access);
  } catch (e) {
    $('invite-error').textContent = e.message;
  }
};

async function removeCollaborator(userId) {
  const { access } = await api(`/api/documents/${currentDoc.id}/collaborators/${userId}`, {
    method: 'DELETE',
  });
  renderAccess(access);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

refreshMe();
