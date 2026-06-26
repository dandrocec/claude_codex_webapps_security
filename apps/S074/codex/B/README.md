# PHP Multi-Vendor Marketplace

A small secure marketplace where vendors manage only their own products and orders, while buyers shop products from all vendors with one cart.

## Run locally on port 5074

Requirements: PHP 8.2+ with `pdo_sqlite` and Composer.

```powershell
composer install
$env:APP_SECRET="replace-with-a-long-random-secret"
$env:APP_ENV="local"
composer serve
```

Then open `http://127.0.0.1:5074`.

The app creates its SQLite database automatically at `var/marketplace.sqlite`.

## Demo flow

- Register as a vendor, then create products from the vendor dashboard.
- Register as a buyer, browse all active products, add items to the cart, and place an order.
- Vendors can view only order items for their own products.

Security controls include parameterised PDO queries, Argon2id password hashing, input validation, escaped output, CSRF tokens for state-changing requests, role and ownership checks, secure session settings, security headers, and generic error handling.
