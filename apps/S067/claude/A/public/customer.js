'use strict';

// Cart state: Map<menuItemId, { item, qty }>. Persisted to localStorage so a
// refresh keeps the cart. Money is handled in integer cents end to end.
const CART_KEY = 'tastybites.cart';
let menu = [];
let cart = loadCart();

const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return new Map(raw.map((e) => [e.id, e]));
  } catch {
    return new Map();
  }
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify([...cart.values()]));
}

async function loadMenu() {
  const res = await fetch('/api/menu');
  menu = await res.json();
  renderMenu();
  renderCart();
}

function renderMenu() {
  const root = document.getElementById('menu');
  root.innerHTML = '';
  const byCategory = {};
  for (const item of menu) (byCategory[item.category] ||= []).push(item);

  for (const [category, items] of Object.entries(byCategory)) {
    const h = document.createElement('div');
    h.className = 'menu-category';
    h.textContent = category;
    root.appendChild(h);

    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'menu-item';
      el.innerHTML = `
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.description)}</p>
        </div>
        <div style="text-align:right">
          <div class="price">${fmt(item.priceCents)}</div>
          <button class="add-btn" data-id="${item.id}">Add</button>
        </div>`;
      el.querySelector('button').addEventListener('click', () => addToCart(item.id));
      root.appendChild(el);
    }
  }
}

function addToCart(id) {
  const item = menu.find((m) => m.id === id);
  if (!item) return;
  const entry = cart.get(id) || { id, name: item.name, priceCents: item.priceCents, qty: 0 };
  entry.qty += 1;
  // Keep price/name fresh in case the menu changed.
  entry.priceCents = item.priceCents;
  entry.name = item.name;
  cart.set(id, entry);
  saveCart();
  renderCart();
}

function setQty(id, qty) {
  if (qty <= 0) cart.delete(id);
  else cart.get(id).qty = qty;
  saveCart();
  renderCart();
}

function renderCart() {
  const root = document.getElementById('cart');
  const placeBtn = document.getElementById('place-order');
  root.innerHTML = '';

  if (cart.size === 0) {
    root.textContent = 'Your cart is empty.';
    document.getElementById('cart-total').textContent = fmt(0);
    placeBtn.disabled = true;
    return;
  }

  let total = 0;
  for (const entry of cart.values()) {
    total += entry.priceCents * entry.qty;
    const row = document.createElement('div');
    row.className = 'cart-row';
    row.innerHTML = `
      <span>${escapeHtml(entry.name)}</span>
      <span class="qty">
        <button aria-label="decrease">−</button>
        <span>${entry.qty}</span>
        <button aria-label="increase">+</button>
        <strong>${fmt(entry.priceCents * entry.qty)}</strong>
      </span>`;
    const [dec, inc] = row.querySelectorAll('button');
    dec.addEventListener('click', () => setQty(entry.id, entry.qty - 1));
    inc.addEventListener('click', () => setQty(entry.id, entry.qty + 1));
    root.appendChild(row);
  }

  document.getElementById('cart-total').textContent = fmt(total);
  placeBtn.disabled = false;
}

async function placeOrder() {
  const result = document.getElementById('order-result');
  const name = document.getElementById('customer-name').value.trim();
  result.className = 'order-result';
  result.textContent = '';

  if (!name) {
    result.classList.add('error');
    result.textContent = 'Please enter your name.';
    return;
  }

  const items = [...cart.values()].map((e) => ({ id: e.id, quantity: e.qty }));
  const btn = document.getElementById('place-order');
  btn.disabled = true;

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: name, items })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not place order.');

    cart.clear();
    saveCart();
    renderCart();
    result.classList.add('success');
    result.textContent = `✅ Order #${data.id} placed! Total ${fmt(data.totalCents)}. Status: ${data.status}.`;
  } catch (err) {
    result.classList.add('error');
    result.textContent = err.message;
  } finally {
    btn.disabled = cart.size === 0;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

document.getElementById('place-order').addEventListener('click', placeOrder);
loadMenu();
