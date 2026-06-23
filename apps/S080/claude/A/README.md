# Warehouse Management App

A small Node.js / Express application for warehouse staff. Staff can view and
manage stock levels and process customer orders that decrement stock. An order
is **rejected** if any line item has insufficient stock — orders are never
partially fulfilled and stock can never go negative.

Data is stored in a local **SQLite** database (via `better-sqlite3`).

## Roles

| Role      | View stock | Process orders | Add products / adjust stock |
|-----------|:----------:|:--------------:|:---------------------------:|
| `clerk`   | ✅         | ✅             | ❌                          |
| `manager` | ✅         | ✅             | ✅                          |

## Requirements

- Node.js 18 or newer (includes npm)

## Run it locally (port 5080)

```bash
# 1. Install dependencies
npm install

# 2. Create the database and seed demo users + products
npm run seed

# 3. Start the server
npm start
```

Then open <http://localhost:5080>.

To run on a different port: `PORT=3000 npm start` (the default is 5080).

## Demo accounts

Created by `npm run seed`:

| Username  | Password     | Role    |
|-----------|--------------|---------|
| `manager` | `manager123` | manager |
| `clerk`   | `clerk123`   | clerk   |

## How it works

- **Stock** lives in the `products` table. Managers add products and adjust
  quantities (add / remove / set) from the **Stock** page.
- **Processing an order** (`Process order` page) runs inside a single database
  transaction: every requested line is re-checked against current stock; if any
  product is short, the whole transaction rolls back and the order is rejected
  with a clear message. On success, stock is decremented and the order is
  recorded with its line items.
- **Authentication** is session-based; passwords are hashed with bcrypt.

## Project layout

```
server.js            App entry point, middleware, route wiring
db/
  connection.js      Shared SQLite connection
  schema.js          Table definitions
  seed.js            Demo users + products (npm run seed)
routes/
  auth.js            Login / logout
  products.js        Stock viewing + management (manager-only writes)
  orders.js          Order processing with atomic stock decrement
middleware/auth.js   requireLogin / requireRole guards
views/               EJS templates
public/style.css     Styling
```

## Notes

- The SQLite database file is created at `db/warehouse.db` and is git-ignored.
  Delete it to start fresh, then re-run `npm run seed`.
- For a real deployment, set a strong `SESSION_SECRET` environment variable.
