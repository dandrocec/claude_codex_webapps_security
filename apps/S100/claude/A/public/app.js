'use strict';

const state = {
  user: null,
  services: [],
  selectedId: null,
  stream: null, // active EventSource
  editingService: null,
};

// --- API helper ---
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- Auth ---
async function init() {
  const { user } = await api('GET', '/api/me');
  if (user) {
    enterApp(user);
  } else {
    show('login-view');
    hide('app-view');
  }
}

function enterApp(user) {
  state.user = user;
  hide('login-view');
  show('app-view');
  document.body.classList.toggle('viewer', user.role !== 'operator');
  const badge = $('user-badge');
  badge.textContent = `${user.username} · ${user.role}`;
  badge.className = `badge role-${user.role}`;
  loadServices();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    const { user } = await api('POST', '/api/login', {
      username: $('login-username').value,
      password: $('login-password').value,
    });
    enterApp(user);
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  closeStream();
  state.user = null;
  state.selectedId = null;
  location.reload();
});

// --- Services ---
async function loadServices() {
  const { services } = await api('GET', '/api/services');
  state.services = services;
  renderServiceList();
  if (state.selectedId && services.some((s) => s.id === state.selectedId)) {
    selectService(state.selectedId);
  } else {
    state.selectedId = null;
    show('empty-state');
    hide('service-detail');
  }
}

function renderServiceList() {
  const ul = $('service-list');
  ul.innerHTML = '';
  if (!state.services.length) {
    ul.innerHTML = '<li class="muted small">No services yet.</li>';
    return;
  }
  for (const s of state.services) {
    const li = document.createElement('li');
    li.className = s.id === state.selectedId ? 'active' : '';
    li.innerHTML = `<div class="svc-name">${esc(s.name)}</div>
      <div class="svc-meta">${s.steps.length} step(s)</div>`;
    li.addEventListener('click', () => selectService(s.id));
    ul.appendChild(li);
  }
}

async function selectService(id) {
  state.selectedId = id;
  closeStream();
  hide('log-panel');
  renderServiceList();
  hide('empty-state');
  show('service-detail');

  const { service } = await api('GET', `/api/services/${id}`);
  $('sd-name').textContent = service.name;
  $('sd-desc').textContent = service.description || '';
  $('sd-repo').textContent = service.repo_url || '';

  const steps = $('sd-steps');
  steps.innerHTML = service.steps.length
    ? service.steps.map((st) => `<li><strong>${esc(st.name)}</strong><br><code>${esc(st.command)}</code></li>`).join('')
    : '<li class="muted">No steps defined.</li>';

  await Promise.all([loadSecrets(id), loadDeployments(id)]);
}

async function loadSecrets(id) {
  const { secrets } = await api('GET', `/api/services/${id}/secrets`);
  const tbody = $('sd-secrets');
  if (!secrets.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">No secrets.</td></tr>';
    return;
  }
  tbody.innerHTML = secrets.map((s) => `
    <tr>
      <td><code>${esc(s.key)}</code></td>
      <td class="muted small">${esc(s.updated_at)}</td>
      <td class="operator-only"><button class="small danger" data-secret="${esc(s.key)}">Delete</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('button[data-secret]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete secret "${btn.dataset.secret}"?`)) return;
      await api('DELETE', `/api/services/${id}/secrets/${encodeURIComponent(btn.dataset.secret)}`);
      loadSecrets(id);
    });
  });
}

async function loadDeployments(id) {
  const { deployments } = await api('GET', `/api/services/${id}/deployments`);
  const tbody = $('sd-deployments');
  if (!deployments.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="muted">No deployments yet.</td></tr>';
    return;
  }
  tbody.innerHTML = deployments.map((d) => `
    <tr>
      <td>#${d.id}</td>
      <td><span class="status status-${d.status}">${d.status}</span></td>
      <td>${esc(d.triggered_by_name || '—')}</td>
      <td class="muted small">${esc(d.started_at || '—')}</td>
      <td class="muted small">${esc(d.finished_at || '—')}</td>
      <td><button class="small" data-dep="${d.id}">Logs</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('button[data-dep]').forEach((btn) => {
    btn.addEventListener('click', () => openLogs(Number(btn.dataset.dep)));
  });
}

// --- Deploy + logs ---
$('deploy-btn').addEventListener('click', async () => {
  const id = state.selectedId;
  try {
    const { deployment_id } = await api('POST', `/api/services/${id}/deploy`);
    await loadDeployments(id);
    openLogs(deployment_id);
  } catch (err) {
    alert(err.message);
  }
});

function openLogs(deploymentId) {
  closeStream();
  show('log-panel');
  $('log-dep-id').textContent = `#${deploymentId}`;
  $('log-status').textContent = '';
  $('log-status').className = 'badge';
  const out = $('log-output');
  out.innerHTML = '';

  const es = new EventSource(`/api/deployments/${deploymentId}/stream`);
  state.stream = es;

  es.addEventListener('log', (e) => {
    const row = JSON.parse(e.data);
    const div = document.createElement('div');
    div.className = `log-line-${row.stream}`;
    div.textContent = row.line;
    out.appendChild(div);
    out.scrollTop = out.scrollHeight;
  });

  es.addEventListener('end', (e) => {
    const { status } = JSON.parse(e.data);
    const badge = $('log-status');
    badge.textContent = status;
    badge.className = `status status-${status}`;
    closeStream();
    if (state.selectedId) loadDeployments(state.selectedId);
  });

  es.onerror = () => { closeStream(); };
}

function closeStream() {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
}

$('close-log-btn').addEventListener('click', () => {
  closeStream();
  hide('log-panel');
});

// --- Service modal ---
$('new-service-btn').addEventListener('click', () => openServiceModal(null));
$('edit-service-btn').addEventListener('click', () => {
  const svc = state.services.find((s) => s.id === state.selectedId);
  openServiceModal(svc);
});

function openServiceModal(svc) {
  state.editingService = svc;
  $('service-modal-title').textContent = svc ? 'Edit service' : 'New service';
  $('svc-name').value = svc ? svc.name : '';
  $('svc-desc').value = svc ? svc.description || '' : '';
  $('svc-repo').value = svc ? svc.repo_url || '' : '';
  $('svc-steps').value = svc ? svc.steps.map((s) => s.command).join('\n') : '';
  $('service-modal-error').textContent = '';
  show('service-modal');
}

$('service-cancel').addEventListener('click', () => hide('service-modal'));

$('service-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('service-modal-error').textContent = '';
  const steps = $('svc-steps').value
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((command) => ({ command }));
  const payload = {
    name: $('svc-name').value.trim(),
    description: $('svc-desc').value.trim(),
    repo_url: $('svc-repo').value.trim(),
    steps,
  };
  try {
    let result;
    if (state.editingService) {
      result = await api('PUT', `/api/services/${state.editingService.id}`, payload);
    } else {
      result = await api('POST', '/api/services', payload);
    }
    hide('service-modal');
    state.selectedId = result.service.id;
    await loadServices();
  } catch (err) {
    $('service-modal-error').textContent = err.message;
  }
});

$('delete-service-btn').addEventListener('click', async () => {
  const svc = state.services.find((s) => s.id === state.selectedId);
  if (!svc || !confirm(`Delete service "${svc.name}" and all its deployments/secrets?`)) return;
  await api('DELETE', `/api/services/${svc.id}`);
  state.selectedId = null;
  await loadServices();
});

// --- Secret modal ---
$('add-secret-btn').addEventListener('click', () => {
  $('secret-key').value = '';
  $('secret-value').value = '';
  $('secret-modal-error').textContent = '';
  show('secret-modal');
});
$('secret-cancel').addEventListener('click', () => hide('secret-modal'));

$('secret-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('secret-modal-error').textContent = '';
  const key = $('secret-key').value.trim();
  try {
    await api('PUT', `/api/services/${state.selectedId}/secrets/${encodeURIComponent(key)}`, {
      value: $('secret-value').value,
    });
    hide('secret-modal');
    loadSecrets(state.selectedId);
  } catch (err) {
    $('secret-modal-error').textContent = err.message;
  }
});

// --- helpers ---
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

init().catch((err) => {
  document.body.innerHTML = `<pre style="color:#f87171;padding:20px">${esc(err.message)}</pre>`;
});
