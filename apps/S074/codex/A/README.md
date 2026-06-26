# Multi-Vendor Marketplace

A plain PHP marketplace where vendors manage only their own products and order lines, while buyers shop across all vendors with one cart. Data is stored in SQLite and initialized automatically on first request.

## Run locally on port 5074

```bash
composer install
composer run serve
```

Then open:

```text
http://127.0.0.1:5074
```

You can also run it without Composer scripts:

```bash
php -S 127.0.0.1:5074 -t public
```

## Demo accounts

- Buyer: `buyer@example.com` / `password`
- Vendor A: `vendor-a@example.com` / `password`
- Vendor B: `vendor-b@example.com` / `password`

The SQLite database is created at `data/marketplace.sqlite`.
