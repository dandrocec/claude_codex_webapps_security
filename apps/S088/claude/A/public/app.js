'use strict';

// --- Tiny API helper ------------------------------------------------------
async function api(method, url, body, isForm) {
  const opts = { method, headers: {} };
  if (body && isForm) {
    opts.body = body; // FormData; let the browser set the boundary header.
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const $ = (id) => document.getElementById(id);
const state = { user: null, folderId: null, folders: [], groups: [] };

// --- Auth -----------------------------------------------------------------
async function refresh() {
  try {
    state.user = await api('GET', '/api/auth/me');
    showApp();
  } catch {
    showAuth();
  }
}

function showAuth() {
  $('auth-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
  $('user-bar').innerHTML = '';
}

async function showApp() {
  $('auth-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  $('user-bar').innerHTML =
    `<span>${state.user.username}</span> <button id="logout" class="secondary">Log out</button>`;
  $('logout').onclick = async () => { await api('POST', '/api/auth/logout'); refresh(); };
  await Promise.all([loadFolders(), loadGroups()]);
  loadDocuments();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    state.user = await api('POST', '/api/auth/login', {
      username: f.get('username'), password: f.get('password'),
    });
    showApp();
  } catch (err) { $('auth-msg').textContent = err.message; }
});

$('register-btn').addEventListener('click', async () => {
  const f = new FormData($('login-form'));
  if (!f.get('username') || !f.get('password')) {
    $('auth-msg').textContent = 'Enter a username and password to register.';
    return;
  }
  try {
    state.user = await api('POST', '/api/auth/register', {
      username: f.get('username'), password: f.get('password'),
    });
    showApp();
  } catch (err) { $('auth-msg').textContent = err.message; }
});

// --- Folders --------------------------------------------------------------
async function loadFolders() {
  state.folders = await api('GET', '/api/folders');
  const ul = $('folder-list');
  ul.innerHTML = '';

  const allLi = document.createElement('li');
  allLi.textContent = '📂 All documents';
  allLi.className = state.folderId === null ? 'active' : '';
  allLi.onclick = () => selectFolder(null);
  ul.appendChild(allLi);

  for (const folder of state.folders) {
    const li = document.createElement('li');
    li.className = state.folderId === folder.id ? 'active' : '';
    const label = document.createElement('span');
    label.textContent = (folder.owned ? '📁 ' : '🔗 ') + folder.name;
    label.style.flex = '1';
    label.onclick = () => selectFolder(folder.id);
    li.appendChild(label);

    if (folder.owned) {
      const actions = document.createElement('span');
      actions.className = 'tag-actions';
      actions.innerHTML =
        `<button class="secondary" data-share>Share</button>` +
        `<button class="danger" data-del>×</button>`;
      actions.querySelector('[data-share]').onclick = (e) => {
        e.stopPropagation(); openShareModal('folder', folder.id, folder.name);
      };
      actions.querySelector('[data-del]').onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Delete folder "${folder.name}" and its documents?`)) {
          await api('DELETE', `/api/folders/${folder.id}`);
          if (state.folderId === folder.id) state.folderId = null;
          loadFolders(); loadDocuments();
        }
      };
      li.appendChild(actions);
    }
    ul.appendChild(li);
  }
}

function selectFolder(id) {
  state.folderId = id;
  loadFolders();
  loadDocuments();
}

$('folder-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = new FormData(e.target).get('name');
  await api('POST', '/api/folders', { name, parentId: state.folderId || undefined });
  e.target.reset();
  loadFolders();
});

// --- Groups ---------------------------------------------------------------
async function loadGroups() {
  state.groups = await api('GET', '/api/groups');
  const ul = $('group-list');
  ul.innerHTML = '';
  for (const g of state.groups) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = '👥 ' + g.name;
    label.style.flex = '1';
    li.appendChild(label);
    if (g.is_owner) {
      const btn = document.createElement('button');
      btn.className = 'secondary'; btn.textContent = 'Members';
      btn.onclick = () => openGroupModal(g);
      li.appendChild(btn);
    }
    ul.appendChild(li);
  }
}

$('group-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = new FormData(e.target).get('name');
  try {
    await api('POST', '/api/groups', { name });
    e.target.reset();
    loadGroups();
  } catch (err) { alert(err.message); }
});

async function openGroupModal(group) {
  const members = await api('GET', `/api/groups/${group.id}/members`);
  const users = await api('GET', '/api/auth/users');
  const memberIds = new Set(members.map((m) => m.id));
  const options = users
    .filter((u) => !memberIds.has(u.id))
    .map((u) => `<option value="${u.id}">${u.username}</option>`)
    .join('');

  openModal(`
    <h2>Members of "${group.name}"</h2>
    <ul class="list" id="member-list">
      ${members.map((m) => `<li><span>${m.username}</span>
        <button class="danger" data-remove="${m.id}">remove</button></li>`).join('')}
    </ul>
    <form id="add-member" class="inline">
      <select name="userId">${options || '<option value="">No users to add</option>'}</select>
      <button type="submit">Add member</button>
    </form>
  `);

  document.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = async () => {
      await api('DELETE', `/api/groups/${group.id}/members/${b.dataset.remove}`);
      openGroupModal(group);
    };
  });
  $('add-member').onclick = null;
  $('add-member').addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = new FormData(e.target).get('userId');
    if (!userId) return;
    await api('POST', `/api/groups/${group.id}/members`, { userId: Number(userId) });
    openGroupModal(group);
  });
}

// --- Documents ------------------------------------------------------------
async function loadDocuments() {
  const folder = state.folders.find((f) => f.id === state.folderId);
  $('docs-title').textContent = folder ? `📁 ${folder.name}` : 'All documents';
  const url = state.folderId ? `/api/documents?folderId=${state.folderId}` : '/api/documents';
  const docs = await api('GET', url);
  const body = $('docs-body');
  body.innerHTML = '';
  if (!docs.length) {
    body.innerHTML = '<tr><td colspan="5"><small>No documents yet.</small></td></tr>';
    return;
  }
  for (const d of docs) {
    const tr = document.createElement('tr');
    const isOwner = d.owner_id === state.user.id;
    const accessBadge = isOwner
      ? '<span class="badge owner">owner</span>'
      : `<span class="badge ${d.permission}">${d.permission}</span>`;
    const v = d.current_version;
    tr.innerHTML = `
      <td>${d.name}</td>
      <td><small>${isOwner ? 'you' : 'user #' + d.owner_id}</small></td>
      <td>${accessBadge}</td>
      <td>${v ? 'v' + v.number + ' <small>(' + fmtBytes(v.size) + ')</small>' : '—'}</td>
      <td class="tag-actions"></td>`;
    const actions = tr.querySelector('.tag-actions');

    addBtn(actions, 'Download', 'secondary', () =>
      (window.location = `/api/documents/${d.id}/download`));
    addBtn(actions, 'History', 'secondary', () => openHistoryModal(d));
    if (d.permission === 'edit') {
      addBtn(actions, 'New version', 'secondary', () => uploadVersion(d));
    }
    if (isOwner) {
      addBtn(actions, 'Share', 'secondary', () => openShareModal('document', d.id, d.name));
      addBtn(actions, '×', 'danger', async () => {
        if (confirm(`Delete "${d.name}"?`)) { await api('DELETE', `/api/documents/${d.id}`); loadDocuments(); }
      });
    }
    body.appendChild(tr);
  }
}

function addBtn(parent, label, cls, onclick) {
  const b = document.createElement('button');
  b.className = cls; b.textContent = label; b.onclick = onclick;
  parent.appendChild(b);
}

$('upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  if (state.folderId) fd.append('folderId', state.folderId);
  try {
    await api('POST', '/api/documents', fd, true);
    e.target.reset();
    $('docs-msg').textContent = '';
    loadDocuments();
  } catch (err) { $('docs-msg').textContent = err.message; }
});

function uploadVersion(doc) {
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    if (!input.files.length) return;
    const fd = new FormData();
    fd.append('file', input.files[0]);
    await api('POST', `/api/documents/${doc.id}/versions`, fd, true);
    loadDocuments();
  };
  input.click();
}

async function openHistoryModal(doc) {
  const data = await api('GET', `/api/documents/${doc.id}/versions`);
  const canEdit = doc.permission === 'edit' || doc.owner_id === state.user.id;
  const rows = data.versions.map((v) => {
    const current = v.id === data.document.current_version_id;
    return `<tr>
      <td>v${v.version_number}${current ? ' <span class="badge owner">current</span>' : ''}</td>
      <td><small>${v.uploaded_by} · ${v.created_at}</small><br>
          <small>${v.original_name} (${fmtBytes(v.size)})</small>
          ${v.note ? `<br><small>📝 ${v.note}</small>` : ''}</td>
      <td>
        <button class="secondary" onclick="window.location='/api/documents/${doc.id}/download?versionId=${v.id}'">Download</button>
        ${canEdit && !current ? `<button data-restore="${v.id}">Restore</button>` : ''}
      </td></tr>`;
  }).join('');

  openModal(`<h2>History — ${doc.name}</h2>
    <table><thead><tr><th>Version</th><th>Details</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`);

  document.querySelectorAll('[data-restore]').forEach((b) => {
    b.onclick = async () => {
      await api('POST', `/api/documents/${doc.id}/restore/${b.dataset.restore}`);
      closeModal();
      loadDocuments();
    };
  });
}

// --- Sharing --------------------------------------------------------------
async function openShareModal(resourceType, resourceId, name) {
  const [shares, users] = await Promise.all([
    api('GET', `/api/shares/${resourceType}/${resourceId}`),
    api('GET', '/api/auth/users'),
  ]);
  const groups = state.groups;

  const shareRows = shares.map((s) => `<li>
      <span>${s.principal_type === 'user' ? '👤' : '👥'} ${s.principal_name}
        <span class="badge ${s.permission}">${s.permission}</span></span>
      <button class="danger" data-revoke="${s.id}">revoke</button></li>`).join('');

  const userOpts = users
    .filter((u) => u.id !== state.user.id)
    .map((u) => `<option value="user:${u.id}">👤 ${u.username}</option>`).join('');
  const groupOpts = groups
    .map((g) => `<option value="group:${g.id}">👥 ${g.name}</option>`).join('');

  openModal(`<h2>Share "${name}"</h2>
    <ul class="list">${shareRows || '<li><small>Not shared yet.</small></li>'}</ul>
    <form id="share-form" class="inline">
      <select name="principal">${userOpts}${groupOpts}</select>
      <select name="permission"><option value="view">view</option><option value="edit">edit</option></select>
      <button type="submit">Grant</button>
    </form>
    <small>Folder shares cascade to every document inside.</small>`);

  document.querySelectorAll('[data-revoke]').forEach((b) => {
    b.onclick = async () => {
      await api('DELETE', `/api/shares/${b.dataset.revoke}`);
      openShareModal(resourceType, resourceId, name);
    };
  });
  $('share-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const [principalType, principalId] = f.get('principal').split(':');
    await api('POST', `/api/shares/${resourceType}/${resourceId}`, {
      principalType, principalId: Number(principalId), permission: f.get('permission'),
    });
    openShareModal(resourceType, resourceId, name);
  });
}

// --- Modal helpers --------------------------------------------------------
function openModal(html) {
  $('modal-body').innerHTML = html;
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }
$('modal-close').onclick = closeModal;
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

refresh();
