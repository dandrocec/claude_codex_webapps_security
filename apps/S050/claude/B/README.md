# Photo Blog (PHP)

A small photo blog. Logged-in users publish posts consisting of an **image + caption**;
a public feed shows all posts newest-first. Authors can **edit and delete their own**
posts. Data is stored in a database (SQLite, zero setup).

The app is written in plain PHP with no runtime framework dependency, so it runs with
just a PHP binary.

## Requirements

- **PHP 8.1+** with the `pdo_sqlite`, `fileinfo`, and `gd` extensions
  (all standard and bundled with typical PHP builds).
- Optionally [Composer](https://getcomposer.org/) — only used to read the dependency
  manifest (`composer.json`). **No third-party packages are required to run.**

Check your PHP:

```bash
php -v
php -m | grep -E "pdo_sqlite|fileinfo|gd"
```

## Run it locally on port 5050

1. (Optional) Create your environment file:

   ```bash
   cp .env.example .env
   ```

   The defaults work out of the box for local development. No secrets need to be set
   for local SQLite use; any secrets the app reads come from the environment, never
   from source.

2. Start the built-in PHP server (the document root is `public/`, and `public/index.php`
   acts as the router):

   ```bash
   php -S 127.0.0.1:5050 -t public public/index.php
   ```

   On Windows PowerShell the command is identical.

   If you have Composer installed you can instead run:

   ```bash
   composer start
   ```

3. Open <http://127.0.0.1:5050> in your browser.

   - Click **Register** to create an account, then **New post** to publish an image.
   - The SQLite database and schema are created automatically on first request
     (at `storage/database.sqlite`).

## Project layout

```
public/
  index.php     Front controller + router (the only web-accessible PHP)
  style.css     Stylesheet
src/
  config.php    Env loading, error handling, security headers, hardened sessions
  db.php        PDO/SQLite connection + schema migration
  helpers.php   Auth, CSRF, output encoding, upload validation/storage
templates/      Server-rendered views (auto-escaped output)
storage/
  database.sqlite   Created on first run
  uploads/          Uploaded images (NOT web-served; streamed via /media/{id})
```

## Security measures (OWASP Top 10)

- **SQL injection** — every query uses PDO prepared statements with bound parameters;
  emulated prepares are disabled.
- **Password storage** — hashed with Argon2id (falls back to bcrypt), with automatic
  rehash on login when parameters change. Plaintext passwords are never stored.
- **XSS** — all dynamic output is HTML-escaped (`htmlspecialchars`, `ENT_QUOTES`) via the
  `e()` helper; a strict Content-Security-Policy (`script-src 'none'`) is also set.
- **CSRF** — a per-session token is required on every state-changing POST and verified
  with `hash_equals`; cookies use `SameSite=Lax`.
- **Access control / IDOR** — edit and delete operations load the post and verify it
  belongs to the current user (and the `UPDATE`/`DELETE` are additionally scoped by
  `user_id`). Unauthorized access returns 403/404.
- **Session security** — cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when served
  over HTTPS (auto-detected; forceable via `SESSION_SECURE=1`). The session id is
  regenerated on login to prevent fixation.
- **Security headers** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, a restrictive CSP, and `Permissions-Policy`.
- **Error handling** — internal errors are logged server-side; clients only ever see a
  generic message (no stack traces). `display_errors` is off in production.
- **Secrets** — read from environment variables / `.env`; nothing sensitive is hardcoded.

### File-upload hardening

- **Allow-list by inspected content** — the real MIME type is detected with `finfo` and
  cross-checked with `getimagesize()`; the client-supplied filename and `Content-Type`
  are ignored. Only JPEG, PNG, GIF, and WebP are accepted.
- **Size limit** — uploads larger than `MAX_UPLOAD_BYTES` (default 5 MiB) are rejected.
- **Random server-generated names** — files are stored as `<32 hex>.<ext>`; the original
  filename is never used.
- **Non-executable, isolated storage** — uploads live in `storage/uploads/`, **outside**
  the `public/` web root, so they can never be executed. They are streamed back through
  the `/media/{id}` endpoint with a locked `Content-Type` and `nosniff`.
- **Path-traversal prevention** — stored names are validated against a strict pattern and
  resolved with `realpath`, confirming the final path stays inside the upload directory.

## Notes

- For a production deployment, serve behind a real web server over HTTPS (which enables the
  `Secure` cookie flag automatically) and point the document root at `public/` only.
