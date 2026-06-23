# Nimbus Store — Flask E-Commerce Platform

A full-stack e-commerce demo built with **Flask** and **SQLite**, featuring a
customer storefront and an admin back office. All money totals are computed
**server-side** from authoritative product prices (stored as integer cents).

## Features

### Customer storefront
- Register / log in / log out (session auth, hashed passwords)
- Browse, search, and filter products by category
- Product detail pages with average ratings and reviews
- Add to cart, update quantities, remove items (stock-aware)
- Checkout with server-side total calculation and inventory decrement
- Order history and order detail pages
- Leave a star rating + review on products you've purchased

### Admin back office
- Dashboard with revenue, order, customer, and low-stock stats
- Product management: create, edit, delete (soft-deactivate if previously sold)
- Inventory management: set absolute stock levels with low-stock alerts
- Order management: filter by status, view details, update status
  (cancelling an order automatically restocks its items)

## Tech stack
- Python 3.9+ / Flask 3
- Flask-SQLAlchemy ORM over SQLite
- Server-rendered Jinja2 templates, plain CSS (no build step)

## Running locally (port 5097)

### 1. Create a virtual environment and install dependencies

```bash
python -m venv venv

# Windows (PowerShell)
venv\Scripts\Activate.ps1
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Seed the database with demo data (optional but recommended)

```bash
python seed.py
```

This creates the SQLite database (`store.db`), 10 sample products, and two
demo accounts:

| Role     | Email                 | Password     |
|----------|-----------------------|--------------|
| Admin    | `admin@shop.test`     | `admin123`   |
| Customer | `customer@shop.test`  | `customer123`|

### 3. Start the app

```bash
python app.py
```

Then open **http://localhost:5097** in your browser.

- Storefront: <http://localhost:5097/>
- Admin back office: <http://localhost:5097/admin> (log in as the admin account)

The database tables are created automatically on first run, so seeding is
optional — but without it there will be no products or admin account.

## Project structure

```
.
├── app.py              # Application factory + all routes (storefront, auth, admin)
├── models.py           # SQLAlchemy models (User, Product, Cart, Order, Review)
├── config.py           # Configuration (secret key, database URI)
├── seed.py             # Demo data seeder
├── requirements.txt    # Python dependencies
├── static/
│   └── style.css
└── templates/
    ├── base.html       # Shared layout
    ├── *.html          # Storefront + auth pages
    └── admin/*.html    # Admin back-office pages
```

## Notes on correctness & security
- **Totals are always recomputed server-side** at checkout from current product
  prices; the client never supplies prices or totals.
- Order line items store a **snapshot** of the product name and unit price so
  historical orders remain accurate even if a product later changes or is removed.
- Inventory is decremented atomically within the checkout transaction, and stock
  is re-validated before the order is committed to prevent overselling.
- Passwords are hashed with Werkzeug (`generate_password_hash`).
- Reviews are restricted to customers who have actually purchased the product.
- `SECRET_KEY` defaults to a dev value; set the `SECRET_KEY` environment variable
  in any real deployment.
```
