# RealEstate — secure PHP property listings

A small but complete real-estate marketplace built with plain PHP (no framework)
and SQLite. **Agents** register, post property listings with photos, and manage
their own listings. **Visitors** browse, search/filter by price and location, and
contact an agent through a form.

Security is built in by default (see [Security](#security) below): parameterised
queries, Argon2id/bcrypt password hashing, CSRF protection, context-aware output
encoding, hardened sessions and headers, strict access control, and locked-down
file uploads.

---

## Requirements

- **PHP 8.1+** with the `pdo_sqlite`, `fileinfo`, and `mbstring` extensions
  (all bundled with standard PHP builds).
- No database server needed — data is stored in a local SQLite file.
- Composer is **optional** (the app ships a small built-in autoloader and `.env`
  parser, so it runs without `composer install`).

Check your PHP:

```bash
php -v
php -m | grep -E "pdo_sqlite|fileinfo|mbstring"
```

---

## Run it locally on port 5066

From the project root:

```bash
# 1. (Optional) configure environment — sensible defaults are used otherwise.
cp .env.example .env
#    Then set a strong APP_KEY, e.g.:
php -r "echo bin2hex(random_bytes(32)).PHP_EOL;"

# 2. (Optional) install Composer deps + autoloader (works fine without it too).
composer install

# 3. (Optional) seed demo listings and a demo agent account.
php bin/seed.php

# 4. Start the app on port 5066.
php -S 127.0.0.1:5066 -t public public/index.php
```

If you ran Composer, you can also use the shortcut:

```bash
composer start
```

Now open <http://127.0.0.1:5066>.

The SQLite database (`storage/app.sqlite`) and tables are created automatically
on first request.

### Demo account (after `php bin/seed.php`)

| Email               | Password        |
| ------------------- | --------------- |
| `agent@example.com` | `DemoAgent123!` |

Or just click **Agent sign-up** to create your own account.

---

## Using the app

- **Visitors** (no login): browse the home page, use the search bar to filter by
  keyword, location, min/max price and minimum bedrooms, open a listing, and send
  the agent a message.
- **Agents** (logged in): the **Dashboard** lists your properties and incoming
  enquiries. Create a listing via **New listing**, attach photos, and edit or
  delete your own listings. You can only ever modify listings you own.

---

## Project layout

```
public/            # web root (the ONLY directory exposed by the server)
  index.php        #   front controller / router
  assets/app.css   #   stylesheet
src/               # application code (PSR-4: App\)
  Config.php       #   env-driven configuration
  Database.php     #   PDO/SQLite + auto-migration
  Session.php      #   hardened sessions + security headers
  Csrf.php         #   CSRF tokens
  Auth.php         #   registration / login / password hashing
  Uploads.php      #   hardened file-upload handling
  Listings.php     #   parameterised data access
  Controllers/     #   request handlers
views/             # PHP templates (output is HTML-escaped)
storage/           # SQLite DB + uploaded files — NOT web-accessible
bin/seed.php       # demo data seeder
```

Uploaded images live in `storage/uploads/` (outside the web root) and are served
only through the `/image?id=…` route, which streams the file with a safe
content-type and `X-Content-Type-Options: nosniff`.

---

## Configuration

All configuration comes from the environment (real env vars override `.env`).
See `.env.example` for the full list. Key settings:

| Variable           | Default              | Purpose                                            |
| ------------------ | -------------------- | -------------------------------------------------- |
| `APP_ENV`          | `local`              | `local` or `production`.                           |
| `APP_DEBUG`        | `false`              | Show detailed errors on screen (keep off in prod). |
| `APP_KEY`          | _(derived fallback)_ | 32+ byte secret; used as a password pepper.        |
| `SESSION_SECURE`   | _(auto)_             | Force `Secure` cookies; auto-detects HTTPS.        |
| `DB_PATH`          | `storage/app.sqlite` | SQLite database file.                              |
| `UPLOAD_DIR`       | `storage/uploads`    | Where photos are stored (outside web root).        |
| `MAX_UPLOAD_BYTES` | `5242880` (5 MiB)    | Max size per uploaded photo.                       |

> **Note on cookies over HTTP:** on plain-HTTP `localhost`, the `Secure` cookie
> flag is auto-disabled so login works in development. In production behind HTTPS
> it turns on automatically (or set `SESSION_SECURE=true`). Always run production
> over HTTPS.

---

## Security

OWASP Top 10 controls applied throughout:

- **Injection (A03):** every SQL statement uses PDO **prepared, parameterised
  queries** (`src/Listings.php`, `src/Auth.php`). `LIKE` filters escape wildcards.
- **Auth & cryptographic failures (A02/A07):** passwords hashed with
  **Argon2id** (falling back to **bcrypt**), salted automatically, plus an
  HMAC **pepper** from `APP_KEY`. Login uses constant-time verification and a
  generic error to avoid user enumeration; session IDs are regenerated on login.
- **XSS:** all dynamic output is HTML-escaped via the `e()` helper
  (`htmlspecialchars`, `ENT_QUOTES`). A strict **Content-Security-Policy**
  (no inline scripts/styles) is sent on every page.
- **CSRF:** synchroniser tokens on **every** state-changing POST
  (`src/Csrf.php`), verified with `hash_equals`.
- **Broken access control / IDOR (A01):** agent actions verify ownership of the
  target listing/photo before reading or writing (`AgentController::ownedListingOr404`).
- **Security misconfiguration (A05):** hardened session cookies
  (`HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS) and headers (`CSP`,
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS on HTTPS). `X-Powered-By` removed.
- **No information leakage:** a global exception handler logs errors server-side
  and shows a generic 500 page; stack traces are only shown when `APP_DEBUG=true`.
- **Secrets management:** no secrets are hard-coded; all are read from the
  environment.

### File-upload hardening (`src/Uploads.php`)

- **Allow-list by inspected content**, not the client filename or `Content-Type`:
  `finfo` MIME detection **and** an independent `getimagesize()` check must agree
  (JPEG/PNG/WEBP/GIF only). Defeats disguised payloads / polyglots.
- **Enforced max size** (`MAX_UPLOAD_BYTES`), checked against the reported and
  actual file size.
- **Server-generated random filenames** (`random_bytes`), never the user's name.
- **Stored outside the web root** in `storage/uploads/`, written non-executable
  (`0640`), and served only via the `/image` route.
- **Path-traversal proof:** stored names must be a bare basename matching a strict
  character allow-list, and the resolved real path is confined to the upload
  directory before any read/write.

---

## Notes / production hardening

This is a self-contained demo intended to run from the PHP built-in server. For a
real deployment you would additionally: serve behind HTTPS (a reverse proxy or
Apache/nginx), point the document root at `public/`, set `APP_ENV=production` and
a strong `APP_KEY`, add rate limiting / brute-force protection on login, and send
real email for enquiries (they are currently stored in the database and shown on
the agent dashboard).
