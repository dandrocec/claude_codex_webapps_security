const menuGrid = document.querySelector("#menuGrid");
const categoryFilters = document.querySelector("#categoryFilters");
const cartItems = document.querySelector("#cartItems");
const cartTotal = document.querySelector("#cartTotal");
const orderForm = document.querySelector("#orderForm");
const orderMessage = document.querySelector("#orderMessage");

let menuItems = [];
let activeCategory = "All";
const cart = new Map();

function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

function renderCategories() {
  const categories = ["All", ...new Set(menuItems.map((item) => item.category))];
  categoryFilters.innerHTML = categories
    .map(
      (category) => `
        <button class="${category === activeCategory ? "active" : ""}" data-category="${category}" type="button">
          ${category}
        </button>
      `
    )
    .join("");
}

function renderMenu() {
  const visibleItems = activeCategory === "All"
    ? menuItems
    : menuItems.filter((item) => item.category === activeCategory);

  menuGrid.innerHTML = visibleItems
    .map(
      (item) => `
        <article class="menu-card">
          <div>
            <span class="category">${item.category}</span>
            <h3>${item.name}</h3>
            <p>${item.description}</p>
          </div>
          <div class="card-action">
            <strong>${formatMoney(item.price_cents)}</strong>
            <button type="button" data-add="${item.id}">Add</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderCart() {
  const lines = [...cart.values()];
  const total = lines.reduce((sum, line) => sum + line.item.price_cents * line.quantity, 0);
  cartTotal.textContent = formatMoney(total);

  if (lines.length === 0) {
    cartItems.className = "cart-items empty";
    cartItems.textContent = "Your cart is empty.";
    return;
  }

  cartItems.className = "cart-items";
  cartItems.innerHTML = lines
    .map(
      ({ item, quantity }) => `
        <div class="cart-line">
          <div>
            <strong>${item.name}</strong>
            <span>${formatMoney(item.price_cents)} each</span>
          </div>
          <div class="quantity-controls" aria-label="Quantity controls for ${item.name}">
            <button type="button" data-decrement="${item.id}">-</button>
            <span>${quantity}</span>
            <button type="button" data-increment="${item.id}">+</button>
          </div>
        </div>
      `
    )
    .join("");
}

function addToCart(itemId) {
  const item = menuItems.find((menuItem) => menuItem.id === itemId);
  if (!item) return;

  const current = cart.get(itemId);
  cart.set(itemId, { item, quantity: current ? current.quantity + 1 : 1 });
  renderCart();
}

categoryFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-category]");
  if (!button) return;

  activeCategory = button.dataset.category;
  renderCategories();
  renderMenu();
});

menuGrid.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-add]");
  if (!button) return;
  addToCart(Number(button.dataset.add));
});

cartItems.addEventListener("click", (event) => {
  const increment = event.target.closest("button[data-increment]");
  const decrement = event.target.closest("button[data-decrement]");
  const itemId = Number((increment || decrement || {}).dataset?.increment || (decrement || {}).dataset?.decrement);

  if (!itemId) return;

  const line = cart.get(itemId);
  if (!line) return;

  if (increment) {
    line.quantity += 1;
  } else {
    line.quantity -= 1;
    if (line.quantity <= 0) cart.delete(itemId);
  }

  renderCart();
});

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  orderMessage.textContent = "";

  const items = [...cart.values()].map(({ item, quantity }) => ({
    menuItemId: item.id,
    quantity
  }));

  if (items.length === 0) {
    orderMessage.textContent = "Add at least one item before placing an order.";
    return;
  }

  const response = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: document.querySelector("#customerName").value,
      customerPhone: document.querySelector("#customerPhone").value,
      items
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    orderMessage.textContent = payload.error || "Could not place order.";
    return;
  }

  cart.clear();
  orderForm.reset();
  renderCart();
  orderMessage.textContent = `Order #${payload.order.id} placed. Total: $${payload.order.total}.`;
});

async function loadMenu() {
  const response = await fetch("/api/menu");
  const payload = await response.json();
  menuItems = payload.items;
  renderCategories();
  renderMenu();
  renderCart();
}

loadMenu();
