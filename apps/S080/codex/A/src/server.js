const path = require("path");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();

const PORT = Number(process.env.PORT || 5080);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "..", "warehouse.db");

const app = express();
const db = new sqlite3.Database(DB_FILE);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.sqlite", dir: path.join(__dirname, "..") }),
    secret: process.env.SESSION_SECRET || "local-development-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" }
  })
);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    res.redirect("/login");
    return;
  }
  next();
}

function requireManager(req, res, next) {
  if (!req.session.user || req.session.user.role !== "manager") {
    flash(req, "error", "Manager access is required.");
    res.redirect("/");
    return;
  }
  next();
}

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

async function initDb() {
  await run("PRAGMA foreign_keys = ON");
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('clerk', 'manager'))
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
      reorder_level INTEGER NOT NULL DEFAULT 0 CHECK(reorder_level >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('fulfilled', 'rejected')),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      stock_before INTEGER NOT NULL,
      stock_after INTEGER NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    )
  `);

  const userCount = await get("SELECT COUNT(*) AS count FROM users");
  if (userCount.count === 0) {
    await run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", [
      "manager",
      bcrypt.hashSync("manager123", 10),
      "manager"
    ]);
    await run("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", [
      "clerk",
      bcrypt.hashSync("clerk123", 10),
      "clerk"
    ]);
  }

  const productCount = await get("SELECT COUNT(*) AS count FROM products");
  if (productCount.count === 0) {
    const products = [
      ["PAL-100", "Pallet wrap", 120, 30],
      ["BOX-220", "Shipping box medium", 260, 75],
      ["LBL-010", "Barcode labels", 900, 200],
      ["TAP-045", "Packing tape", 64, 20]
    ];
    for (const product of products) {
      await run(
        "INSERT INTO products (sku, name, quantity, reorder_level) VALUES (?, ?, ?, ?)",
        product
      );
    }
  }
}

app.get("/login", (req, res) => {
  if (req.session.user) {
    res.redirect("/");
    return;
  }
  res.render("login");
});

app.post("/login", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const user = await get("SELECT * FROM users WHERE username = ?", [username]);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      flash(req, "error", "Invalid username or password.");
      res.redirect("/login");
      return;
    }

    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", requireAuth, async (req, res, next) => {
  try {
    const products = await all("SELECT * FROM products ORDER BY name");
    const recentOrders = await all(`
      SELECT orders.*, users.username
      FROM orders
      JOIN users ON users.id = orders.user_id
      ORDER BY orders.created_at DESC, orders.id DESC
      LIMIT 8
    `);
    res.render("dashboard", { products, recentOrders });
  } catch (err) {
    next(err);
  }
});

app.post("/products", requireAuth, requireManager, async (req, res, next) => {
  try {
    const sku = String(req.body.sku || "").trim().toUpperCase();
    const name = String(req.body.name || "").trim();
    const quantity = Number.parseInt(req.body.quantity, 10);
    const reorderLevel = Number.parseInt(req.body.reorder_level, 10);

    if (!sku || !name || quantity < 0 || reorderLevel < 0 || Number.isNaN(quantity) || Number.isNaN(reorderLevel)) {
      flash(req, "error", "Enter a SKU, name, and non-negative stock values.");
      res.redirect("/");
      return;
    }

    await run(
      "INSERT INTO products (sku, name, quantity, reorder_level) VALUES (?, ?, ?, ?)",
      [sku, name, quantity, reorderLevel]
    );
    flash(req, "success", "Product created.");
    res.redirect("/");
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      flash(req, "error", "That SKU already exists.");
      res.redirect("/");
      return;
    }
    next(err);
  }
});

app.post("/products/:id/adjust", requireAuth, requireManager, async (req, res, next) => {
  try {
    const productId = Number.parseInt(req.params.id, 10);
    const newQuantity = Number.parseInt(req.body.quantity, 10);
    const reorderLevel = Number.parseInt(req.body.reorder_level, 10);

    if (newQuantity < 0 || reorderLevel < 0 || Number.isNaN(newQuantity) || Number.isNaN(reorderLevel)) {
      flash(req, "error", "Stock and reorder level must be non-negative.");
      res.redirect("/");
      return;
    }

    await run("UPDATE products SET quantity = ?, reorder_level = ? WHERE id = ?", [
      newQuantity,
      reorderLevel,
      productId
    ]);
    flash(req, "success", "Stock updated.");
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.get("/orders/new", requireAuth, async (req, res, next) => {
  try {
    const products = await all("SELECT * FROM products ORDER BY name");
    res.render("new-order", { products });
  } catch (err) {
    next(err);
  }
});

app.post("/orders", requireAuth, async (req, res, next) => {
  try {
    const productIds = Array.isArray(req.body.product_id) ? req.body.product_id : [req.body.product_id];
    const requested = [];

    for (const rawProductId of productIds) {
      const productId = Number.parseInt(rawProductId, 10);
      const quantity = Number.parseInt(req.body[`quantity_${productId}`], 10);
      if (!Number.isNaN(productId) && !Number.isNaN(quantity) && quantity > 0) {
        requested.push({ productId, quantity });
      }
    }

    if (requested.length === 0) {
      flash(req, "error", "Add at least one item with a positive quantity.");
      res.redirect("/orders/new");
      return;
    }

    await run("BEGIN IMMEDIATE TRANSACTION");
    try {
      const items = [];
      for (const item of requested) {
        const product = await get("SELECT * FROM products WHERE id = ?", [item.productId]);
        if (!product) {
          throw new Error("One of the selected products no longer exists.");
        }
        if (product.quantity < item.quantity) {
          const order = await run("INSERT INTO orders (user_id, status, note) VALUES (?, 'rejected', ?)", [
            req.session.user.id,
            `Insufficient stock for ${product.sku}: requested ${item.quantity}, available ${product.quantity}.`
          ]);
          await run("COMMIT");
          flash(req, "error", `Order ${order.id} rejected: insufficient stock for ${product.name}.`);
          res.redirect("/orders");
          return;
        }
        items.push({ product, quantity: item.quantity });
      }

      const order = await run("INSERT INTO orders (user_id, status, note) VALUES (?, 'fulfilled', ?)", [
        req.session.user.id,
        String(req.body.note || "").trim()
      ]);

      for (const item of items) {
        const stockAfter = item.product.quantity - item.quantity;
        await run("UPDATE products SET quantity = ? WHERE id = ?", [stockAfter, item.product.id]);
        await run(
          `INSERT INTO order_items
            (order_id, product_id, quantity, stock_before, stock_after)
           VALUES (?, ?, ?, ?, ?)`,
          [order.id, item.product.id, item.quantity, item.product.quantity, stockAfter]
        );
      }

      await run("COMMIT");
      flash(req, "success", `Order ${order.id} fulfilled and stock was decremented.`);
      res.redirect("/orders");
    } catch (err) {
      await run("ROLLBACK");
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

app.get("/orders", requireAuth, async (req, res, next) => {
  try {
    const orders = await all(`
      SELECT orders.*, users.username
      FROM orders
      JOIN users ON users.id = orders.user_id
      ORDER BY orders.created_at DESC, orders.id DESC
    `);
    const items = await all(`
      SELECT order_items.*, products.sku, products.name
      FROM order_items
      JOIN products ON products.id = order_items.product_id
      ORDER BY order_items.id
    `);
    const itemsByOrder = items.reduce((map, item) => {
      map[item.order_id] = map[item.order_id] || [];
      map[item.order_id].push(item);
      return map;
    }, {});
    res.render("orders", { orders, itemsByOrder });
  } catch (err) {
    next(err);
  }
});

app.get("/users", requireAuth, requireManager, async (req, res, next) => {
  try {
    const users = await all("SELECT id, username, role FROM users ORDER BY username");
    res.render("users", { users });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", { error: err });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Warehouse app listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database", err);
    process.exit(1);
  });
