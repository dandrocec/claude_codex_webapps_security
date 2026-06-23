'use strict';

const STATUSES = ['pending', 'preparing', 'ready', 'completed', 'cancelled'];
const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;
let refreshTimer = null;

const loginPane = document.getElementById('login-pane');
const ordersPane = document.getElementById('orders-pane');

async function checkSession() {
  const res = await fetch('/api/me');
  const { isStaff } = await res.json();
  if (isStaff) showOrders();
  else showLogin();
}

function showLogin() {
  loginPane.classList.remove('hidden');
  ordersPane.classList.add('hidden');
  stopAutoRefresh();
}

function showOrders() {
  loginPane.classList.add('hidden');
  ordersPane.classList.remove('hidden');
  loadOrders();
  if (document.getElementById('auto-refresh').checked) startAutoRefresh();
}

async function login() {
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (res.ok) {
    document.getElementById('password').value = '';
    showOrders();
  } else {
    const data = await res.json().catch(() => ({}));
    errEl.textContent = data.error || 'Login failed.';
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  showLogin();
}

async function loadOrders() {
  const root = document.getElementById('orders');
  let res;
  try {
    res = await fetch('/api/orders');
  } catch {
    root.textContent = 'Network error.';
    return;
  }
  if (res.status === 401) {
    showLogin();
    return;
  }
  const orders = await res.json();
  if (!orders.length) {
    root.textContent = 'No orders yet.';
    return;
  }
  root.innerHTML = '';
  for (const order of orders) root.appendChild(renderOrder(order));
}

function renderOrder(order) {
  const card = document.createElement('div');
  card.className = 'order-card';

  const itemsHtml = order.items
    .map(
      (i) =>
        `<li>${i.quantity} × ${escapeHtml(i.name)} <span class="meta">(${fmt(i.unitPriceCents)} ea)</span></li>`
    )
    .join('');

  const options = STATUSES.map(
    (s) => `<option value="${s}"${s === order.status ? ' selected' : ''}>${s}</option>`
  ).join('');

  card.innerHTML = `
    <div class="order-head">
      <h3>Order #${order.id} — ${escapeHtml(order.customerName)}</h3>
      <span class="badge ${order.status}">${order.status}</span>
    </div>
    <div class="meta">${new Date(order.createdAt + 'Z').toLocaleString()}</div>
    <ul>${itemsHtml}</ul>
    <div class="order-foot">
      <strong>Total: ${fmt(order.totalCents)}</strong>
      <label class="meta">Update status:
        <select>${options}</select>
      </label>
    </div>`;

  const select = card.querySelector('select');
  select.addEventListener('change', () => updateStatus(order.id, select.value));
  return card;
}

async function updateStatus(id, status) {
  const res = await fetch(`/api/orders/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  if (res.status === 401) return showLogin();
  loadOrders();
}

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(loadOrders, 5000);
}
function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

document.getElementById('login-btn').addEventListener('click', login);
document.getElementById('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('logout-btn').addEventListener('click', logout);
document.getElementById('refresh-btn').addEventListener('click', loadOrders);
document.getElementById('auto-refresh').addEventListener('change', (e) => {
  if (e.target.checked) startAutoRefresh();
  else stopAutoRefresh();
});

checkSession();
