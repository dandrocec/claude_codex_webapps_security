const state = {
  userName: localStorage.getItem('collab:user') || '',
  socket: null,
  documents: [],
  activeDocument: null,
  activeAccess: [],
  suppressEditorEvent: false,
  saveTimer: null
};

const els = {
  userForm: document.getElementById('userForm'),
  userName: document.getElementById('userName'),
  createForm: document.getElementById('createForm'),
  newTitle: document.getElementById('newTitle'),
  refreshButton: document.getElementById('refreshButton'),
  documentList: document.getElementById('documentList'),
  titleInput: document.getElementById('titleInput'),
  documentMeta: document.getElementById('documentMeta'),
  status: document.getElementById('status'),
  editor: document.getElementById('editor'),
  inviteForm: document.getElementById('inviteForm'),
  inviteName: document.getElementById('inviteName'),
  inviteRole: document.getElementById('inviteRole'),
  accessList: document.getElementById('accessList')
};

els.userName.value = state.userName;

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-name': state.userName,
      ...(options.headers || {})
    }
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Request failed.');
    return body;
  });
}

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status ${kind}`.trim();
}

function requireUser() {
  if (!state.userName.trim()) {
    setStatus('Choose user', 'error');
    return false;
  }
  return true;
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  if (!requireUser()) return;

  state.socket = io({ auth: { userName: state.userName } });
  state.socket.on('connect', () => setStatus('Live', 'live'));
  state.socket.on('disconnect', () => setStatus('Offline'));
  state.socket.on('connect_error', (error) => setStatus(error.message, 'error'));

  state.socket.on('document:updated', ({ id, content, editor, updatedAt }) => {
    if (!state.activeDocument || Number(id) !== Number(state.activeDocument.id)) return;
    state.suppressEditorEvent = true;
    els.editor.value = content;
    state.suppressEditorEvent = false;
    state.activeDocument.content = content;
    state.activeDocument.updatedAt = updatedAt;
    els.documentMeta.textContent = `${state.activeDocument.role} access. Last edit by ${editor}.`;
  });

  state.socket.on('document:renamed', ({ id, title, updatedAt }) => {
    if (!state.activeDocument || Number(id) !== Number(state.activeDocument.id)) return;
    state.activeDocument.title = title;
    state.activeDocument.updatedAt = updatedAt;
    els.titleInput.value = title;
    renderDocuments();
  });

  state.socket.on('access:updated', ({ id, access }) => {
    if (!state.activeDocument || Number(id) !== Number(state.activeDocument.id)) return;
    state.activeAccess = access;
    renderAccess();
  });
}

async function loadDocuments() {
  if (!requireUser()) return;
  const data = await api('/api/documents');
  state.documents = data.documents;
  renderDocuments();
}

function renderDocuments() {
  els.documentList.innerHTML = '';

  if (!state.documents.length) {
    els.documentList.innerHTML = '<p class="empty">No documents yet.</p>';
    return;
  }

  state.documents.forEach((doc) => {
    const item = window.document.createElement('button');
    item.type = 'button';
    item.className = `documentItem ${state.activeDocument && state.activeDocument.id === doc.id ? 'active' : ''}`;
    item.innerHTML = `
      <strong>${escapeHtml(doc.title)}</strong>
      <span>${doc.role} access - ${doc.accessCount} user${doc.accessCount === 1 ? '' : 's'}</span>
    `;
    item.addEventListener('click', () => openDocument(doc.id));
    els.documentList.appendChild(item);
  });
}

async function openDocument(id) {
  if (!requireUser()) return;
  const data = await api(`/api/documents/${id}`);
  state.activeDocument = data.document;
  state.activeAccess = data.access;
  renderActiveDocument();
  renderAccess();

  if (state.socket && state.socket.connected) {
    state.socket.emit('document:join', { documentId: id }, (response) => {
      if (response && response.error) setStatus(response.error, 'error');
    });
  }
}

function renderActiveDocument() {
  const document = state.activeDocument;
  if (!document) return;

  const editable = document.role === 'owner' || document.role === 'edit';
  els.titleInput.value = document.title;
  els.titleInput.disabled = !editable;
  els.editor.disabled = !editable;
  els.editor.value = document.content || '';
  els.documentMeta.textContent = `${document.role} access. Owner: ${document.ownerName}.`;
  renderDocuments();
}

function renderAccess() {
  els.accessList.innerHTML = '';

  if (!state.activeDocument) {
    els.accessList.innerHTML = '<p class="empty">Open a document to view access.</p>';
    return;
  }

  const isOwner = state.activeDocument.role === 'owner';
  els.inviteForm.querySelectorAll('input, select, button').forEach((el) => {
    el.disabled = !isOwner;
  });

  state.activeAccess.forEach((entry) => {
    const item = window.document.createElement('div');
    item.className = 'accessItem';
    item.innerHTML = `
      <strong>${escapeHtml(entry.name)}</strong>
      <span>${entry.role}</span>
    `;

    if (isOwner && entry.role !== 'owner') {
      const remove = window.document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => removeAccess(entry.id));
      item.appendChild(remove);
    }

    els.accessList.appendChild(item);
  });
}

async function createDocument(event) {
  event.preventDefault();
  if (!requireUser()) return;

  const title = els.newTitle.value.trim() || 'Untitled document';
  const data = await api('/api/documents', {
    method: 'POST',
    body: JSON.stringify({ title })
  });
  els.newTitle.value = '';
  await loadDocuments();
  state.activeDocument = data.document;
  state.activeAccess = data.access;
  renderActiveDocument();
  renderAccess();
  openDocument(data.document.id);
}

function queueContentSave() {
  if (state.suppressEditorEvent || !state.activeDocument) return;
  if (state.activeDocument.role === 'view') return;

  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.socket.emit('document:edit', {
      documentId: state.activeDocument.id,
      content: els.editor.value
    }, (response) => {
      if (response && response.error) setStatus(response.error, 'error');
      if (response && response.ok) setStatus('Saved', 'live');
    });
  }, 180);
}

async function renameDocument() {
  if (!state.activeDocument || state.activeDocument.role === 'view') return;
  const title = els.titleInput.value.trim();
  if (!title) return;

  const data = await api(`/api/documents/${state.activeDocument.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title })
  });
  state.activeDocument = data.document;
  await loadDocuments();
}

async function invite(event) {
  event.preventDefault();
  if (!state.activeDocument) return;

  const name = els.inviteName.value.trim();
  const role = els.inviteRole.value;
  if (!name) return;

  const data = await api(`/api/documents/${state.activeDocument.id}/access`, {
    method: 'POST',
    body: JSON.stringify({ name, role })
  });
  els.inviteName.value = '';
  state.activeAccess = data.access;
  renderAccess();
}

async function removeAccess(userId) {
  if (!state.activeDocument) return;
  const data = await api(`/api/documents/${state.activeDocument.id}/access/${userId}`, {
    method: 'DELETE'
  });
  state.activeAccess = data.access;
  renderAccess();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

els.userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  state.userName = els.userName.value.trim();
  localStorage.setItem('collab:user', state.userName);
  connectSocket();
  await loadDocuments();
  state.activeDocument = null;
  state.activeAccess = [];
  els.titleInput.value = 'Select or create a document';
  els.editor.value = '';
  els.editor.disabled = true;
  renderAccess();
});

els.createForm.addEventListener('submit', createDocument);
els.refreshButton.addEventListener('click', loadDocuments);
els.editor.addEventListener('input', queueContentSave);
els.titleInput.addEventListener('change', renameDocument);
els.inviteForm.addEventListener('submit', invite);

if (state.userName) {
  connectSocket();
  loadDocuments();
}

renderAccess();
