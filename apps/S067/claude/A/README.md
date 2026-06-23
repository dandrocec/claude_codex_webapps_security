# 🍽️ Tasty Bites — Food Ordering App

A small but complete food-ordering web app built with **Node.js + Express** and
**SQLite** (via `better-sqlite3`).

- **Customers** browse the menu, build a cart, and place an order.
- **Staff** sign in, watch incoming orders live, and update each order's status.
- **Order totals are computed on the server** from the current menu prices — the
  client total is only an estimate and is never trusted.
- Data is stored in a SQLite database file (`data/app.db`), created and seeded
  automatically on first run.

## Requirements

- Node.js **18+** and npm.
- A C/C++ build toolchain is needed to compile `better-sqlite3` (Windows: this
  comes with the "Desktop development with C++" workload or the npm
  windows-build-tools; macOS: Xcode CLT; Linux: `build-essential`). Most systems
  already have one and `npm install` just works.

## Run it locally (port 5067)

```bash
npm install
npm start
```

Then open:

- Customer site: **http://localhost:5067/**
- Staff console: **http://localhost:5067/staff.html**

The app listens on port **5067** by default. To use a different port:

```bash
PORT=8080 npm start        # macOS / Linux
$env:PORT=8080; npm start  # Windows PowerShell
```

## Staff login

| Field    | Default value |
| -------- | ------------- |
| Username | `staff`       |
| Password | `staff123`    |

Override with environment variables: `STAFF_USERNAME`, `STAFF_PASSWORD`, and
`SESSION_SECRET` (recommended for anything beyond local use).

## How it works

| Concern         | Implementation                                                        |
| --------------- | --------------------------------------------------------------------- |
| Menu            | Seeded into the `menu_items` table; served from `GET /api/menu`.      |
| Cart            | Held in the browser (localStorage); sent to the server on checkout.   |
| Placing orders  | `POST /api/orders` validates items and **computes the total server-side**. |
| Staff auth      | Session cookie via `express-session`; role check on staff routes.     |
| Order status    | `PATCH /api/orders/:id/status` (staff only).                          |
| Storage         | SQLite file at `data/app.db` (auto-created, WAL mode).                 |

Order status lifecycle: `pending → preparing → ready → completed` (plus
`cancelled`).

## API reference

| Method & path                  | Auth   | Description                                  |
| ------------------------------ | ------ | -------------------------------------------- |
| `GET /api/menu`                | public | List available menu items.                   |
| `POST /api/orders`             | public | Place an order. Body: `{ customerName, items: [{ id, quantity }] }`. |
| `GET /api/orders/:id`          | public | Fetch a single order (e.g. to poll status).  |
| `GET /api/orders`              | staff  | List all orders (optional `?status=`).       |
| `PATCH /api/orders/:id/status` | staff  | Update an order's status.                    |
| `POST /api/login` / `logout`   | —      | Staff session management.                    |

## Project layout

```
.
├── server.js          # Express app + REST API
├── db.js              # SQLite schema + seed data
├── public/            # Static frontend
│   ├── index.html     # Customer ordering page
│   ├── staff.html     # Staff console
│   ├── customer.js    # Cart + checkout logic
│   ├── staff.js       # Login + orders dashboard
│   └── styles.css
├── package.json
└── README.md
```

## Reset the data

Stop the server and delete the database files, then start again to re-seed:

```bash
rm -rf data/        # macOS / Linux
Remove-Item -Recurse -Force data  # Windows PowerShell
```
