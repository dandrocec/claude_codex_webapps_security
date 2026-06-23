# Multi-Vendor Marketplace (PHP + SQLite)

A small but complete marketplace where **multiple vendors** each manage their own
products and see only their own orders, while **buyers** shop across every vendor
with a **single shared cart**. Built with plain PHP (no framework) and SQLite so
it runs anywhere PHP runs — no database server to install.

## Features

- **Buyers** register, browse the combined catalogue from all vendors, add items
  from different vendors to one cart, and check out. They can view their own
  order history.
- **Vendors** register, create / edit / delete their own products, and see the
  order line items for *their* products only — including the buyer name and the
  quantity sold — never another vendor's data or a buyer's full order total.
- A buyer's checkout splits the cart into per-vendor order line items behind a
  single order, with server-side stock checks in one transaction.

## Requirements

- **PHP 8.1+** with the `pdo_sqlite` extension (bundled with standard PHP builds).
- No Composer dependencies are required — the app ships its own autoloader.
  (A `composer.json` is provided for autoloading/metadata if you prefer to use it.)

Check your PHP:

```bash
php -v
php -m | grep -i sqlite     # should list "pdo_sqlite" / "sqlite3"
```

## Run it locally on port 5074

From the project root:

```bash
# 1. Create your local config (a sensible default is fine for local dev)
cp .env.example .env

# 2. (Recommended) set a strong APP_SECRET used as a password pepper
php -r "echo 'APP_SECRET='.bin2hex(random_bytes(32)).PHP_EOL;"
#    ...then paste that line into .env, replacing the placeholder.

# 3. Create the database schema and demo data
php bin/init-db.php

# 4. Start the app on port 5074 (document root is ./public)
php -S 127.0.0.1:5074 -t public
```

On Windows PowerShell the commands are the same, except use
`copy .env.example .env` instead of `cp`.

Now open <http://127.0.0.1:5074>.

> If you use Composer, `composer run start` and `composer run init-db` are wired
> to the same commands.

### Demo accounts (created by `init-db.php`)

| Role   | Email               | Password       |
| ------ | ------------------- | -------------- |
| Vendor | `acme@vendor.test`  | `Password123!` |
| Vendor | `bloom@vendor.test` | `Password123!` |
| Buyer  | `dana@buyer.test`   | `Password123!` |

Sign in as `dana@buyer.test` to shop across both vendors, then sign in as each
vendor to confirm they only see their own products and order lines. Or just
register fresh accounts from the UI.

To reset everything: `php bin/init-db.php --fresh`.

## Project layout

```
public/            Web root — the ONLY directory exposed to the browser
  index.php        Front controller (routing + dispatch)
  css/app.css      Stylesheet (served from 'self' so CSP forbids inline styles)
src/               Application code (autoloaded App\ namespace), outside web root
  Controllers/     Request handlers
  *.php            Auth, Database, Session, Csrf, Validator, repositories, etc.
views/             PHP templates; all output passes through e() for encoding
database/schema.sql SQLite schema
bin/init-db.php    Schema + demo-data seeder
storage/           SQLite file and logs (created at runtime; outside web root)
.env.example       Configuration template (copy to .env)
```

## Security notes (OWASP Top 10)

This project applies the mandated controls:

- **A01 Broken Access Control / IDOR** — every vendor query is scoped by
  `vendor_id = <current user>` in the SQL `WHERE` clause (see
  `ProductRepository` and `OrderRepository`). Editing/deleting a product you
  don't own returns 404, not the resource. Role gates (`Http::requireVendor()` /
  `requireBuyer()`) protect each route. Redirects are restricted to local paths
  to avoid open redirects.
- **A02 Cryptographic Failures** — passwords are hashed with **Argon2id** (or
  bcrypt where Argon2 isn't compiled in), always salted by `password_hash`, plus
  an HMAC **pepper** from `APP_SECRET` that never touches the database.
- **A03 Injection / XSS** — **100% parameterised queries** via PDO prepared
  statements (no string-concatenated SQL). All template output is HTML-encoded
  through `e()` (`htmlspecialchars`, `ENT_QUOTES`). Input is validated and
  sanitised centrally in `Validator`.
- **A04 Insecure Design** — prices and stock are authoritative server-side; the
  cart only stores quantities, and checkout re-reads prices/stock in a single
  transaction so a tampered client value can't change what you pay.
- **A05 Security Misconfiguration** — strict security headers on every response
  (`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS over HTTPS). `display_errors` is
  off by default; errors are logged to `storage/logs/app.log`.
- **A07 Identification & Authentication Failures** — secure session cookies
  (`HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS / when `SESSION_SECURE=true`),
  session-id regeneration on login and periodically, a minimum password length,
  and generic login errors that don't reveal whether an email is registered.
- **CSRF** — every state-changing `POST` carries a per-session synchroniser
  token (`Csrf::field()`), verified with `hash_equals()` in the router before
  any handler runs.
- **Error handling** — a global exception handler renders a generic page and
  logs the detail; stack traces are never sent to clients (unless you explicitly
  set `APP_DEBUG=true` for local debugging).
- **No hardcoded secrets** — all configuration (`APP_SECRET`, `DB_PATH`,
  `SESSION_SECURE`, `APP_DEBUG`) is read from the environment / `.env`, which is
  git-ignored.

### Production hardening checklist

- Serve over HTTPS and set `SESSION_SECURE=true`.
- Set a unique, random `APP_SECRET`; keep `APP_DEBUG=false`.
- Change or remove the demo accounts.
- Put the app behind a real web server (nginx/Apache) with `public/` as the
  document root, or keep using `php -S` only for local development.
