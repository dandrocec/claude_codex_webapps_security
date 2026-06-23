# MultiMart — a multi-vendor PHP marketplace

A small but complete marketplace where **multiple vendors** each manage their own
products and see only their own orders, while **buyers** shop across every vendor
using a single shared cart. All data is stored in a SQLite database.

## Features

- **Vendors** register, manage their own product catalog (create / edit / delete),
  and view orders containing *only their own items* — they can never see another
  vendor's products, orders, buyers, or revenue.
- **Buyers** browse and search products from all vendors, add items from different
  vendors to one cart, and check out in a single step. Each checkout is split into
  per-vendor line items behind the scenes.
- **Data isolation** is enforced at the query level: every vendor query is scoped
  by `vendor_id`, and product edits/deletes require an ownership match.
- Sessions for auth, hashed passwords (`password_hash`), CSRF protection on every
  form, and stock tracking with a transactional checkout.
- Zero external services: data lives in a self-initializing SQLite file.

## Requirements

- **PHP 8.0+** with the `pdo_sqlite` extension (bundled with standard PHP builds).
- No Composer dependencies are required to run it — `composer.json` is provided as
  the dependency manifest and to expose a `start` script.

Check your PHP:

```bash
php -v
php -m | grep -i sqlite   # should list "pdo_sqlite"
```

## Run it locally on port 5074

From the project root:

```bash
php -S localhost:5074 -t public public/index.php
```

> `public/index.php` is passed as the **router script** so that clean URLs such as
> `/cart` and `/vendor/orders` are handled by the app rather than returning 404.

Or, if you have Composer installed:

```bash
composer start
```

Then open **http://localhost:5074** in your browser.

The database (`data/marketplace.sqlite`) is created automatically on first request
and seeded with demo accounts and products.

## Demo accounts

All demo accounts use the password **`password`**.

| Role   | Email             | Notes                       |
|--------|-------------------|-----------------------------|
| Vendor | `alice@shop.test` | Shop: *Alice's Electronics* |
| Vendor | `bob@shop.test`   | Shop: *Bob's Books*         |
| Buyer  | `carol@shop.test` | Shops across all vendors    |

You can also register fresh vendor or buyer accounts from the **Sign up** page.

### Try the isolation guarantee

1. Log in as `carol@shop.test`, add products from **both** Alice and Bob to the
   cart, and check out.
2. Log in as `alice@shop.test` → **My Orders**: you'll see only the electronics
   line items and Alice's subtotal.
3. Log in as `bob@shop.test` → **My Orders**: you'll see only the book line items.
   Neither vendor sees the other's products or totals.

## Project layout

```
public/index.php      Front controller + router (server document root)
src/bootstrap.php     Session + includes
src/db.php            PDO connection, schema migration, demo seed data
src/helpers.php       Auth, CSRF, cart, currency, view rendering
src/controllers.php   Request handlers (storefront, cart, vendor, auth)
views/                PHP templates wrapped by views/layout.php
data/                 SQLite database (created on first run)
composer.json         Dependency manifest
```

## Resetting the data

Delete the database file and restart the server — it will be recreated and
re-seeded on the next request:

```bash
rm data/marketplace.sqlite
```
