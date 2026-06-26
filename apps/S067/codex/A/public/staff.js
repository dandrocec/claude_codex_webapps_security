const ordersList = document.querySelector("#ordersList");
const refreshOrders = document.querySelector("#refreshOrders");
const statuses = ["new", "preparing", "ready", "completed", "cancelled"];

function formatStatus(status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function renderOrders(orders) {
  if (orders.length === 0) {
    ordersList.className = "orders-list empty";
    ordersList.textContent = "No orders yet.";
    return;
  }

  ordersList.className = "orders-list";
  ordersList.innerHTML = orders
    .map(
      (order) => `
        <article class="order-card">
          <div class="order-header">
            <div>
              <span class="category">Order #${order.id}</span>
              <h3>${order.customer_name}</h3>
              <p>${order.customer_phone}</p>
            </div>
            <strong>$${order.total}</strong>
          </div>
          <ul class="order-items">
            ${order.items
              .map((item) => `<li>${item.quantity} x ${item.item_name} <span>$${item.line_total}</span></li>`)
              .join("")}
          </ul>
          <div class="status-row">
            <label>
              Status
              <select data-order-id="${order.id}">
                ${statuses
                  .map((status) => `<option value="${status}" ${status === order.status ? "selected" : ""}>${formatStatus(status)}</option>`)
                  .join("")}
              </select>
            </label>
            <time datetime="${order.created_at}">${new Date(`${order.created_at}Z`).toLocaleString()}</time>
          </div>
        </article>
      `
    )
    .join("");
}

async function loadOrders() {
  const response = await fetch("/api/orders");
  const payload = await response.json();
  renderOrders(payload.orders || []);
}

ordersList.addEventListener("change", async (event) => {
  const select = event.target.closest("select[data-order-id]");
  if (!select) return;

  await fetch(`/api/orders/${select.dataset.orderId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: select.value })
  });

  await loadOrders();
});

refreshOrders.addEventListener("click", loadOrders);
loadOrders();
setInterval(loadOrders, 10000);
