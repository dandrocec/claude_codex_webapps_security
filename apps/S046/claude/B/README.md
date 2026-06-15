# Quotes — a small, security-focused PHP app

Logged-in users submit quotes (text + author). A public page lists all
**approved** quotes and lets visitors filter by author. Submitters can edit
their own quotes; an admin approves submissions before they appear publicly.

Data is stored in a database (SQLite by default — no DB server required).

## Requirements

- **PHP 8.1+** with the `pdo` and `pdo_sqlite` extensions (both ship with PHP).
- Composer is optional — the app runs without third-party packages. `composer.json`
  is provided as the dependency manifest, but a built-in autoloader is used when
  `vendor/` is absent.

Check your setup:

```bash
php -v
php -m | grep -i pdo_sqlite
```

## Run it locally on port 5046

```bash
# 1. Configure environment (copy the example and set a strong APP_KEY)
cp .env.example .env
php -r "echo 'APP_KEY=' . bin2hex(random_bytes(32)) . PHP_EOL;"   # paste into .env

# 2. Create the database schema
php bin/init-db.php          # or: composer init-db

# 3. Start the server (serves the public/ directory)
php -S 127.0.0.1:5046 -t public     # or: composer start
```

Then open <http://127.0.0.1:5046>.

> On Windows PowerShell, the commands are the same; use
> `Copy-Item .env.example .env` instead of `cp`.

### Create an admin (to approve quotes)

Submitted quotes start as **pending** and only appear publicly once approved.

1. Register a normal account through the web UI (e.g. username `admin`).
2. Promote it:

   ```bash
   php bin/make-admin.php admin
   ```

3. Sign in — a **Moderation** link appears in the nav. Approve or reject
   pending quotes there.

## Usage flow

1. **Create account / Sign in.**
2. **Submit** a quote (text + author) — it enters the moderation queue.
3. **Admin approves** it from the Moderation page.
4. The quote appears on the **public home page**, where anyone can filter by author.
5. Submitters can **edit their own** quotes from **My quotes**; editing sends the
   quote back for re-review.

## Configuration (`.env`)

| Variable         | Purpose                                                            |
|------------------|-------------------------------------------------------------------|
| `APP_ENV`        | `development` or `production`. Errors are never shown to clients; in `development` a detail block is added for local debugging. |
| `APP_KEY`        | Long random secret. Generate with `php -r "echo bin2hex(random_bytes(32));"`. |
| `DB_DSN`         | PDO DSN. Default `sqlite:data/quotes.sqlite`. A MySQL DSN such as `mysql:host=127.0.0.1;dbname=quotes;charset=utf8mb4` also works (set `DB_USER`/`DB_PASS`). |
| `SESSION_SECURE` | `true` when served over HTTPS (adds the `Secure` cookie flag + HSTS). Keep `false` for plain `http://localhost`. |

Secrets are read from the environment — **nothing is hardcoded**. Real
environment variables override `.env`.

## Project layout

```
public/index.php      Front controller + router (web root)
public/css/app.css    Styles (no inline CSS/JS, to satisfy a strict CSP)
public/.htaccess      Apache rewrite rules (only needed under Apache)
src/                  Application code (App\ namespace)
  bootstrap.php       Autoload, env, secure session, headers, error handling
  Env.php             .env loader
  Database.php        PDO connection (prepared statements only)
  Auth.php            Registration, login, password hashing, RBAC
  Csrf.php            CSRF synchronizer-token protection
  Quote.php           Quote data access + input validation
  Controllers/        Auth, Quote, Admin controllers
templates/            Server-rendered views (output-encoded with e())
bin/                  init-db.php, make-admin.php
schema.sql            Database schema
```

## Security measures (OWASP Top 10)

- **A01 Broken access control / IDOR** — edit and update are scoped to the
  owning `user_id` (in code *and* in the SQL `WHERE` clause). Moderation routes
  require an admin role via `Auth::requireAdmin()`. The author filter is
  validated against the known set of approved authors.
- **A02 Cryptographic failures** — passwords hashed with `password_hash()`
  (bcrypt/Argon2: strong, salted, adaptive) and transparently rehashed on login
  when the cost changes. Session cookies are `HttpOnly`, `SameSite=Lax`, and
  `Secure` over HTTPS.
- **A03 Injection** — every query uses PDO prepared statements with bound
  parameters; emulated prepares are disabled. No SQL is built from user input.
- **A03 XSS** — all dynamic output is HTML-encoded with `e()`
  (`htmlspecialchars`, `ENT_QUOTES`). A strict Content-Security-Policy forbids
  inline scripts/styles and restricts sources to same-origin.
- **A04 Insecure design** — submissions require admin approval before going
  public; input length limits and allow-listed username characters.
- **A05 Security misconfiguration** — security headers (`X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, CSP, HSTS
  over HTTPS). `display_errors` is off; errors are logged, never shown.
- **A07 Identification & authentication** — session id regenerated on login and
  session start (fixation defence), constant-time password verification with a
  dummy-hash path to reduce username enumeration, minimum password length.
- **CSRF** — synchronizer token required on every POST (`Csrf::check()`),
  validated with `hash_equals()`; `SameSite=Lax` adds defence in depth.
- **Error handling** — a global handler returns a generic message and logs
  details server-side; no stack traces leak to clients.

## Notes

- The SQLite database file lives in `data/` and is created automatically.
- To reset all data, stop the server and delete `data/quotes.sqlite`, then run
  `php bin/init-db.php` again.
