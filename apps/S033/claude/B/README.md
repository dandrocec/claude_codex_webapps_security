# Secure PHP Address Book

A small, dependency-free PHP web app where signed-in users manage their own
contacts (name, email, phone, address) and search them by name. Data is stored
in a database (SQLite by default, MySQL optional).

Built with security as a first-class concern — see **Security** below.

## Features

- User registration and login (passwords hashed with a strong, salted algorithm).
- Add, edit, and delete contacts.
- Search contacts by name.
- Each user can only see and modify **their own** contacts.

## Requirements

- PHP **8.1+** with the `pdo_sqlite` extension (bundled with PHP by default).
- No third-party PHP packages are required to run the app. [Composer](https://getcomposer.org)
  is optional and only used for the autoloader/metadata.

Check your PHP version:

```bash
php -v
```

## Run it locally on port 5033

1. **Get the code** and open a terminal in the project root.

2. **Create your environment file** and set a secret key:

   ```bash
   cp .env.example .env
   ```

   Then set `APP_KEY` in `.env` to a long random string. Generate one with:

   ```bash
   php -r "echo bin2hex(random_bytes(32)).PHP_EOL;"
   ```

   The app **refuses to start** until `APP_KEY` is set.

   > On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

3. **(Optional) Install Composer autoloader.** Not required — the app ships with
   a built-in PSR-4 autoloader fallback:

   ```bash
   composer install
   ```

4. **Start the server** (uses PHP's built-in web server):

   ```bash
   php -S 127.0.0.1:5033 -t public
   ```

   Or, if you ran `composer install`:

   ```bash
   composer start
   ```

5. **Open the app:** http://127.0.0.1:5033

   Register an account, then start adding contacts. The SQLite database and its
   schema are created automatically on first run under `storage/`.

## Using MySQL instead of SQLite (optional)

In `.env`, set:

```dotenv
DB_DRIVER=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=address_book
DB_USER=your_user
DB_PASS=your_password
```

Create the database once (`CREATE DATABASE address_book CHARACTER SET utf8mb4;`).
The tables are created automatically on first run.

## Project layout

```
public/            Web root (front controller + static assets)
  index.php        Router / front controller
  assets/          CSS + a tiny progressive-enhancement JS file
src/               Application code (PSR-4: App\)
  bootstrap.php    Autoload, env, error handling, session, headers
  Controllers/     Auth + Contact controllers
  ...              Database, Auth, Security, Validator, repositories, etc.
views/             PHP templates (escaped at output)
storage/           SQLite DB + error log (gitignored)
.env.example       Configuration template
```

## Security

This app applies OWASP Top 10 best practices:

- **SQL injection** — every query uses PDO prepared statements with bound
  parameters; `LIKE` search wildcards are escaped. No string-built SQL.
- **Password storage** — `password_hash()` with `PASSWORD_DEFAULT` (bcrypt/Argon2),
  a unique per-password salt, and automatic rehashing on algorithm upgrades.
- **Input validation & output encoding** — all input is validated and normalised
  server-side; all output is HTML-escaped with `htmlspecialchars(ENT_QUOTES)`
  (context-aware), preventing XSS.
- **CSRF** — every state-changing request requires a per-session token verified
  with `hash_equals()`; cookies use `SameSite=Strict`.
- **Access control / IDOR** — every contact query is scoped by `user_id`, so users
  can only read or modify their own records.
- **Secure sessions** — cookies are `HttpOnly`, `SameSite=Strict`, and `Secure`
  when served over HTTPS (`SESSION_SECURE=true`); session id is regenerated on
  login and rotated periodically.
- **Security headers** — `Content-Security-Policy` (no inline scripts/styles),
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, and HSTS over HTTPS.
- **Error handling** — internal errors and stack traces are never shown to the
  client; they are logged to `storage/php-error.log`.
- **No hardcoded secrets** — configuration and secrets are read from the
  environment (`.env` / real environment variables).
- **No open redirects** — redirects are restricted to same-app relative paths.

### Production notes

- Serve over HTTPS and set `SESSION_SECURE=true` and `APP_ENV=production` in `.env`.
- Put the app behind a real web server (nginx/Apache/PHP-FPM) with `public/` as the
  document root. The built-in server is for local development only.
- Ensure `storage/` is writable by PHP but **not** served publicly (it sits outside
  the `public/` web root by design).
```
