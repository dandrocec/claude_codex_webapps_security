# Secure PHP Guestbook

A small guestbook web app. Visitors leave a **name** and a **message**; every
message is stored in a database and shown **newest-first** on the main page.
Registered users can delete their own messages; an optional admin can delete any.

It runs on **PHP's built-in web server on port 5029** and stores data in a local
**SQLite** file, so there is nothing else to install or configure.

## Requirements

- **PHP 8.1+** with the `pdo_sqlite` extension (bundled with standard PHP builds).
- No Composer packages are required to run the app — `composer.json` is provided
  as the dependency manifest, but the code has zero third-party runtime deps.

Check your PHP:

```bash
php -v
php -m | grep -i sqlite   # should list pdo_sqlite / sqlite3
```

## Setup

1. Copy the environment template and edit it:

   ```bash
   cp .env.example .env
   ```

2. Generate a strong `APP_KEY` and paste it into `.env`:

   ```bash
   php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
   ```

3. (Optional) To get an admin account that can delete any message, set
   `ADMIN_USERNAME` and a strong `ADMIN_PASSWORD` in `.env`. The account is
   created on first boot and the password is hashed (never stored in plaintext).

`.env` notes:

- `SESSION_SECURE=false` for local `http://` testing. Set it to `true` only when
  you serve the app over HTTPS (it then adds the `Secure` cookie flag + HSTS).
- `APP_ENV=production` hides internal errors from clients. Use `development`
  locally if you want full error output.

## Run locally on port 5029

```bash
php -S 127.0.0.1:5029 -t public public/index.php
```

(or `composer start`, which runs the same command).

Then open <http://127.0.0.1:5029>.

The SQLite database and tables are created automatically on first request at the
path given by `DB_PATH` (default `data/guestbook.sqlite`).

## Using it

- **Post a message** — fill in your name and message on the home page. Anyone can
  post, no account needed.
- **Register / Log in** — create an account so you can delete your own messages.
- **Delete** — a *Delete* button appears only on messages you own (or on every
  message if you are an admin).

## How the security requirements are met

| OWASP area | Where it lives |
|---|---|
| **SQL injection** | All queries use PDO **prepared statements** with bound parameters (`src/Auth.php`, `public/index.php`). Emulated prepares are disabled. |
| **Password storage** | `password_hash()` with **Argon2id** (falls back to bcrypt), per-hash salt managed by PHP (`src/Auth.php`). |
| **XSS** | Context-aware output encoding via `e()` (`htmlspecialchars`, `ENT_QUOTES`) on every value rendered in views; a strict **Content-Security-Policy** with no inline scripts. |
| **Input validation** | Length/charset/format checks and control-character stripping for names, messages, usernames and passwords (`public/index.php`). |
| **CSRF** | Synchronizer token on every state-changing POST, verified with `hash_equals()` (`src/Csrf.php`); checked centrally in `requireCsrf()`. |
| **Access control / IDOR** | Delete handler loads the message, checks `user_id` ownership (or admin) **server-side** before acting (`public/index.php`). |
| **Session security** | `HttpOnly`, `SameSite=Lax`, configurable `Secure` cookies; `session_regenerate_id()` on login to prevent fixation; strict mode + cookies-only (`src/bootstrap.php`). |
| **Security headers** | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, CSP, optional HSTS (`src/bootstrap.php`). |
| **Error handling** | Custom exception/error handlers log details server-side and return a generic message — no stack traces leak to clients (`src/bootstrap.php`). |
| **Secrets management** | `APP_KEY`, DB path and admin seed are read from environment / `.env`; nothing is hardcoded, and the app refuses to boot in production with a default `APP_KEY`. |

## Project layout

```
.
├── composer.json          # dependency manifest (PHP + pdo_sqlite)
├── .env.example           # configuration template (copy to .env)
├── public/
│   ├── index.php          # front controller / router
│   └── assets/app.css     # styles (served as a static file)
├── src/
│   ├── bootstrap.php      # env, sessions, headers, error handling, DB init
│   ├── Database.php       # PDO/SQLite connection + migrations
│   ├── Auth.php           # registration, login, password hashing
│   ├── Csrf.php           # CSRF token issue/verify
│   └── helpers.php        # e(), env(), view(), redirect()
├── views/                 # layout + page templates
└── data/                  # SQLite database lives here (gitignored)
```
