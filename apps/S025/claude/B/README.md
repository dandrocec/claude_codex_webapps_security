# Newsletter — secure PHP email-subscription app

A small PHP application that lets visitors subscribe with their email address,
shows a confirmation, and provides an **admin-only** page listing all
subscribers. Built with the OWASP Top 10 in mind.

- **Subscribe form** (`/`) — stores the email and shows a confirmation.
- **Admin sign in** (`/admin/login`) — protects the subscriber list.
- **Subscribers list** (`/admin/subscribers`) — visible only to a signed-in admin.

Storage is **SQLite**, so there is no database server to install.

## Requirements

- PHP **8.1+** with the `pdo_sqlite` extension (bundled with most PHP builds).
- No external libraries are required at runtime. `composer.json` is the
  dependency manifest and declares the PHP/extension requirements.

Check your PHP:

```bash
php -v
php -m | grep -i pdo_sqlite     # should print "pdo_sqlite"
```

## Setup

1. **Create your environment file** from the template:

   ```bash
   cp .env.example .env
   ```

2. **Create the admin password hash** (no plaintext secrets are stored):

   ```bash
   php bin/generate-admin-hash.php "choose-a-strong-password"
   ```

   Copy the printed hash into `.env` as `ADMIN_PASSWORD_HASH`, and set
   `ADMIN_USERNAME` (defaults to `admin`).

   > On Windows PowerShell, use:
   > `php bin/generate-admin-hash.php "choose-a-strong-password"`

3. *(Optional)* `composer install` — not needed to run, but it sets up the
   autoloader and validates the platform requirements.

## Run locally on port 5025

```bash
php -S 127.0.0.1:5025 -t public public/router.php
```

Then open <http://127.0.0.1:5025>.

(The same command is available as `composer start`.)

The SQLite database and schema are created automatically on first request at
the path given by `DATABASE_PATH` (default `data/app.sqlite`).

## Configuration (`.env`)

| Variable              | Default            | Purpose                                                        |
| --------------------- | ------------------ | -------------------------------------------------------------- |
| `APP_DEBUG`           | `false`            | When `true`, shows error details (use only in development).    |
| `FORCE_HTTPS`         | `false`            | Set `true` behind HTTPS to enable the `Secure` cookie + HSTS.  |
| `DATABASE_PATH`       | `data/app.sqlite`  | SQLite file location (relative paths resolve to project root). |
| `ADMIN_USERNAME`      | `admin`            | Admin login username.                                          |
| `ADMIN_PASSWORD_HASH` | *(empty)*          | bcrypt/argon2 hash of the admin password (see step 2).         |

## Security measures

These map to the mandatory requirements / OWASP Top 10:

- **SQL injection** — all queries use PDO **parameterised statements** with
  emulation disabled; the unique `email` column is enforced at the DB level.
- **Password storage** — admin password is stored only as a salted
  **bcrypt/Argon2id** hash (`password_hash` / `password_verify`); generated via
  `bin/generate-admin-hash.php`. No plaintext, no hardcoded credentials.
- **Input validation & sanitisation** — emails are trimmed, lower-cased,
  length-limited, and validated with `filter_var(... FILTER_VALIDATE_EMAIL)`.
- **XSS** — context-aware output encoding via `htmlspecialchars(ENT_QUOTES)` on
  every dynamic value; a strict **Content-Security-Policy** (`script-src 'none'`,
  no inline styles) provides defence-in-depth.
- **CSRF** — every state-changing `POST` requires a per-session token validated
  in constant time (`hash_equals`), reinforced by `SameSite=Lax` cookies.
- **Access control / IDOR** — the subscriber list is reachable only by an
  authenticated admin (`require_admin()`); the app exposes no per-user resource
  identifiers that could be tampered with.
- **Secure sessions** — cookies are `HttpOnly`, `SameSite=Lax`, and `Secure`
  when served over HTTPS; the session ID is regenerated on login to prevent
  session fixation, and fully cleared on logout.
- **Security headers** — CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and
  HSTS (HTTPS only).
- **Error handling** — `display_errors` is off; uncaught errors are logged
  server-side and a generic 500 page is shown, never a stack trace.
- **Secrets management** — all secrets and config come from environment
  variables (`.env` is git-ignored), never from source.

## Project layout

```
.
├── bin/generate-admin-hash.php   # create the admin password hash
├── composer.json                 # dependency manifest
├── data/                         # SQLite database (git-ignored)
├── public/
│   ├── index.php                 # front controller / router dispatch
│   ├── router.php                # built-in-server router
│   └── assets/style.css          # external stylesheet (CSP-friendly)
├── src/
│   ├── bootstrap.php             # session, headers, error handling
│   ├── Database.php              # PDO + schema
│   ├── env.php                   # .env loader
│   └── helpers.php               # CSRF, escaping, views, auth helpers
└── templates/                    # HTML templates
```
