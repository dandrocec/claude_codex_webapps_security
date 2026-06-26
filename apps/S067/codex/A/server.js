const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 5067;
const db = new Database(path.join(__dirname, "food_ordering.sqlite"));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    total_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
  );
`);

const existingMenuCount = db.prepare("SELECT COUNT(*) AS count FROM menu_items").get().count;
if (existingMenuCount === 0) {
  const insert = db.prepare(`
    INSERT INTO menu_items (name, description, category, price_cents)
    VALUES (@name, @description, @category, @price_cents)
  `);

  [
    {
      name: "Margherita Pizza",
      description: "Tomato, mozzarella, basil, and olive oil on a crisp crust.",
      category: "Pizza",
      price_cents: 1195
    },
    {
      name: "Smoky Chicken Pizza",
      description: "Roasted chicken, smoked paprika sauce, red onion, and provolone.",
      category: "Pizza",
      price_cents: 1450
    },
    {
      name: "Garden Pasta",
      description: "Penne with zucchini, cherry tomatoes, parmesan, and herb oil.",
      category: "Pasta",
      price_cents: 1275
    },
    {
      name: "Beef Ragout Pasta",
      description: "Slow-cooked beef ragout over tagliatelle with shaved parmesan.",
      category: "Pasta",
      price_cents: 1525
    },
    {
      name: "Market Salad",
      description: "Leafy greens, cucumber, carrot, toasted seeds, and lemon vinaigrette.",
      category: "Salads",
      price_cents: 925
    },
    {
      name: "Crispy Halloumi Salad",
      description: "Halloumi, greens, roasted peppers, chickpeas, and yogurt dressing.",
      category: "Salads",
      price_cents: 1175
    },
    {
      name: "House Lemonade",
      description: "Fresh lemon, mint, and sparkling water.",
      category: "Drinks",
      price_cents: 395
    },
    {
      name: "Cold Brew Tea",
      description: "Black tea cold brewed with peach and rosemary.",
      category: "Drinks",
      price_cents: 425
    }
  ].forEach((item) => insert.run(item));
}

const allowedStatuses = new Set(["new", "preparing", "ready", "completed", "cancelled"]);

function centsToDollars(cents) {
  return (cents / 100).toFixed(2);
}

function serializeOrder(order) {
  const items = db
    .prepare(
      `SELECT menu_item_id, item_name, quantity, unit_price_cents, line_total_cents
       FROM order_items
       WHERE order_id = ?
       ORDER BY id ASC`
    )
    .all(order.id);

  return {
    ...order,
    total: centsToDollars(order.total_cents),
    items: items.map((item) => ({
      ...item,
      unit_price: centsToDollars(item.unit_price_cents),
      line_total: centsToDollars(item.line_total_cents)
    }))
  };
}

app.get("/api/menu", (req, res) => {
  const items = db
    .prepare(
      `SELECT id, name, description, category, price_cents
       FROM menu_items
       WHERE active = 1
       ORDER BY category, name`
    )
    .all()
    .map((item) => ({
      ...item,
      price: centsToDollars(item.price_cents)
    }));

  res.json({ items });
});

app.post("/api/orders", (req, res) => {
  const { customerName, customerPhone, items } = req.body || {};

  if (!customerName || !customerPhone) {
    return res.status(400).json({ error: "Customer name and phone are required." });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "At least one cart item is required." });
  }

  const requestedItems = items.map((item) => ({
    menuItemId: Number(item.menuItemId),
    quantity: Number(item.quantity)
  }));

  if (requestedItems.some((item) => !Number.isInteger(item.menuItemId) || !Number.isInteger(item.quantity) || item.quantity < 1)) {
    return res.status(400).json({ error: "Cart items must include valid menu item IDs and quantities." });
  }

  const menuLookup = db.prepare(
    `SELECT id, name, price_cents
     FROM menu_items
     WHERE id = ? AND active = 1`
  );

  const orderLines = [];
  for (const requestedItem of requestedItems) {
    const menuItem = menuLookup.get(requestedItem.menuItemId);
    if (!menuItem) {
      return res.status(400).json({ error: `Menu item ${requestedItem.menuItemId} is unavailable.` });
    }

    const existingLine = orderLines.find((line) => line.menu_item_id === menuItem.id);
    if (existingLine) {
      existingLine.quantity += requestedItem.quantity;
      existingLine.line_total_cents = existingLine.quantity * existingLine.unit_price_cents;
    } else {
      orderLines.push({
        menu_item_id: menuItem.id,
        item_name: menuItem.name,
        quantity: requestedItem.quantity,
        unit_price_cents: menuItem.price_cents,
        line_total_cents: requestedItem.quantity * menuItem.price_cents
      });
    }
  }

  const totalCents = orderLines.reduce((sum, item) => sum + item.line_total_cents, 0);

  const createOrder = db.transaction(() => {
    const orderResult = db
      .prepare(
        `INSERT INTO orders (customer_name, customer_phone, total_cents)
         VALUES (?, ?, ?)`
      )
      .run(customerName.trim(), customerPhone.trim(), totalCents);

    const insertItem = db.prepare(
      `INSERT INTO order_items
       (order_id, menu_item_id, item_name, quantity, unit_price_cents, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const line of orderLines) {
      insertItem.run(
        orderResult.lastInsertRowid,
        line.menu_item_id,
        line.item_name,
        line.quantity,
        line.unit_price_cents,
        line.line_total_cents
      );
    }

    return db.prepare("SELECT * FROM orders WHERE id = ?").get(orderResult.lastInsertRowid);
  });

  const order = createOrder();
  res.status(201).json({ order: serializeOrder(order) });
});

app.get("/api/orders", (req, res) => {
  const orders = db
    .prepare(
      `SELECT *
       FROM orders
       ORDER BY
        CASE status
          WHEN 'new' THEN 1
          WHEN 'preparing' THEN 2
          WHEN 'ready' THEN 3
          WHEN 'completed' THEN 4
          ELSE 5
        END,
        created_at DESC`
    )
    .all()
    .map(serializeOrder);

  res.json({ orders });
});

app.patch("/api/orders/:id/status", (req, res) => {
  const orderId = Number(req.params.id);
  const status = String((req.body && req.body.status) || "").trim();

  if (!Number.isInteger(orderId)) {
    return res.status(400).json({ error: "Invalid order ID." });
  }

  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "Invalid order status." });
  }

  const result = db
    .prepare(
      `UPDATE orders
       SET status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(status, orderId);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Order not found." });
  }

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  res.json({ order: serializeOrder(order) });
});

app.get("/staff", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "staff.html"));
});

app.listen(PORT, () => {
  console.log(`Food ordering app listening on http://localhost:${PORT}`);
});
