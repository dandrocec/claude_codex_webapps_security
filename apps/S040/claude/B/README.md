# Classifieds

A small but complete **PHP classifieds site**. Registered users post items for
sale (title, price, description, photo); visitors browse by category and search;
sellers can edit and remove their own listings. Data is stored in a database
(SQLite by default, MySQL optional). No JavaScript frameworks, no external PHP
packages — it runs with stock PHP.

## Features

- User registration & login (passwords hashed with Argon2id/bcrypt)
- Post an item for sale: title, price, description, optional photo upload
- Browse by category and full-text search across title & description
- Sellers manage **only their own** listings (edit / delete)
- Server-rendered, responsive UI

## Requirements

- **PHP 8.1+** with the `pdo_sqlite` and `fileinfo` extensions (both bundled with
  standard PHP builds). For MySQL instead of SQLite you also need `pdo_mysql`.

Check your setup:

```bash
php -v
php -m | grep -E 'pdo_sqlite|fileinfo'
```

## Run it locally (port 5040)

```bash
# 1. From the project root, create your local config
cp .env.example .env
#    (optional) generate a real secret:
php -r "echo 'APP_SECRET='.bin2hex(random_bytes(32)).PHP_EOL;"   # paste into .env

# 2. Start the built-in PHP web server on port 5040
php -S 127.0.0.1:5040 -t public public/index.php
```

Then open <http://127.0.0.1:5040>.

> On Windows PowerShell the start command is identical:
> `php -S 127.0.0.1:5040 -t public public/index.php`
>
> Or, with Composer installed, simply: `composer start`

The SQLite database and tables are **created automatically** on first request
(at `storage/classifieds.sqlite`), and the category list is seeded for you.
There is nothing else to migrate or import.

To try it out: click **Sign up**, create an account, then **+ Sell** to post a
listing. Open the site in a private window to browse as an anonymous visitor.

## Using MySQL instead of SQLite (optional)

Create a database and user, then set these in `.env`:

```ini
DB_DRIVER=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=classifieds
DB_USER=classifieds
DB_PASSWORD=your-password
```

Tables and categories are created automatically on first request, the same way.

## Configuration (`.env`)

| Variable          | Purpose                                                        |
|-------------------|----------------------------------------------------------------|
| `APP_ENV`         | `development` shows detailed errors; `production` hides them.   |
| `APP_HTTPS`       | Set `true` when served over HTTPS so the `Secure` cookie is set.|
| `APP_SECRET`      | Long random string. **Do not commit it.**                      |
| `DB_DRIVER`       | `sqlite` (default) or `mysql`.                                  |
| `DB_SQLITE_PATH`  | SQLite file path (relative to project root).                   |
| `DB_*`            | MySQL connection details (only when `DB_DRIVER=mysql`).         |

Secrets are read from the environment only — nothing sensitive is hardcoded.

## Project layout

```
public/            Web root (the only directory exposed by the server)
  index.php        Front controller + router
  css/app.css      Styles
  uploads/         Stored listing photos
src/
  bootstrap.php    Env, error handling, sessions, security headers
  env.php          Tiny .env loader
  database.php     PDO connection + auto-migration + category seed
  helpers.php      Output escaping, views, flash messages
  csrf.php         CSRF token generation & validation
  auth.php         Login/logout, password hashing
  controllers/     Request handlers (account, listings)
templates/         Server-rendered views
storage/           SQLite database file (auto-created)
```

## Security overview (OWASP Top 10)

This app was built defensively. Highlights:

- **SQL injection** — every query uses PDO **prepared statements** with bound
  parameters and `ATTR_EMULATE_PREPARES = false`. Search `LIKE` wildcards in user
  input are escaped.
- **Authentication** — passwords hashed with **Argon2id** (falls back to bcrypt),
  automatic rehash on algorithm upgrade, generic login errors with
  constant-time-ish verification to limit user enumeration.
- **Session security** — cookies are `HttpOnly`, `SameSite=Lax`, `Secure` (when
  `APP_HTTPS=true`); strict mode and id regeneration on login mitigate fixation.
- **CSRF** — a per-session token is required on **every** POST and checked with
  `hash_equals` (constant time).
- **XSS** — all dynamic output is HTML-escaped via `e()` (context-aware), plus a
  restrictive **Content-Security-Policy** (`script-src 'self'`, no inline JS).
- **Access control / IDOR** — edit/delete verify ownership (`seller_id` = current
  user) and scope the SQL `WHERE` clause to the owner; others get a generic 404.
- **File upload safety** — type detected from file contents (`finfo` +
  `getimagesize`), size-limited, stored under a random name with a fixed
  extension; originals/paths from the client are never trusted.
- **Input validation** — length/format/range checks on all fields server-side.
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, CSP, and COOP/CORP.
- **Error handling** — exceptions are logged server-side; clients only ever see a
  generic message (no stack traces) in production.
- **Secrets** — read exclusively from environment variables / `.env`.

> This is a demo. For real production use, additionally serve over HTTPS, place
> behind a hardened web server, add rate limiting on auth endpoints, and consider
> serving uploaded files from a separate domain.
