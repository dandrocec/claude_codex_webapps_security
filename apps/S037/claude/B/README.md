# PHP Image Gallery

A small, security-hardened image gallery written in plain PHP (no framework).

- **Registered users** can sign in and upload images with a caption.
- **Everyone** can browse a public gallery of thumbnails; clicking a thumbnail
  opens the full image and its caption.
- Image **metadata** is stored in a SQLite database; the image **files** are
  stored on disk outside the web root and streamed through the application.

The whole app runs on the PHP built-in web server — no database server,
no Composer install, and no JavaScript required.

---

## Requirements

- **PHP 8.1+** (CLI)
- PHP extensions: `pdo_sqlite`, `gd`, `fileinfo`, `session` (all standard).

Check what you have:

```bash
php --version
php -m | grep -E "pdo_sqlite|gd|fileinfo|session"
```

> `composer.json` is provided as the dependency manifest. The app has **no
> third-party runtime dependencies**, so `composer install` is *optional*
> (it only creates an empty `vendor/`). You do not need it to run the app.

---

## Run it locally on port 5037

From the project root:

```bash
# 1. (optional) create a local config file
cp .env.example .env        # then edit if you like; sensible defaults apply

# 2. start the server on port 5037
php -S 127.0.0.1:5037 -t public public/router.php
```

Now open <http://127.0.0.1:5037>.

The same command is available as a Composer script:

```bash
composer start
```

On first run the app automatically creates `storage/database.sqlite` and the
`storage/uploads/` directory.

### First steps

1. Click **Register**, create an account (password must be ≥ 10 characters).
2. Click **Upload**, choose a JPEG/PNG/GIF/WebP file and add a caption.
3. Visit the home page (**Gallery**) — open in a private window to confirm it
   is publicly visible without signing in.

---

## Configuration

All configuration comes from environment variables (or the optional `.env`
file). See [`.env.example`](.env.example). Highlights:

| Variable              | Default                     | Purpose                                          |
| --------------------- | --------------------------- | ------------------------------------------------ |
| `APP_ENV`             | `production`                | `development` shows detailed errors locally.     |
| `DB_PATH`             | `storage/database.sqlite`   | SQLite database file path.                       |
| `UPLOAD_DIR`          | `storage/uploads`           | Where image files are stored (outside web root). |
| `MAX_UPLOAD_BYTES`    | `5242880` (5 MB)            | Maximum accepted upload size.                     |
| `FORCE_SECURE_COOKIE` | auto (on under HTTPS)       | Force the `Secure` cookie flag over plain HTTP.   |

> **Note on upload size:** PHP's own `upload_max_filesize` and `post_max_size`
> (in `php.ini`) also cap uploads. For files near the 5 MB limit, ensure those
> are at least as large, e.g. start the server with:
> `php -d upload_max_filesize=6M -d post_max_size=7M -S 127.0.0.1:5037 -t public public/router.php`

---

## Project layout

```
public/
  router.php        Dev-server router: serves real static files, else delegates
  index.php         Front controller (routing table)
  assets/style.css  Stylesheet (the only static asset)
src/
  bootstrap.php     Config, secure session, security headers, error handling
  Database.php      PDO/SQLite connection + schema migration
  helpers.php       Escaping, CSRF, auth, validation, image processing
  controllers.php   One handler per route
  views/            Server-rendered templates (auto-escaped)
storage/
  uploads/          Uploaded files (random names) — NOT web-served
  database.sqlite   Created on first run
```

---

## Security measures

This project deliberately implements OWASP Top 10 mitigations:

- **SQL injection** — every query uses PDO **prepared statements** with bound
  parameters; no string-built SQL.
- **Password storage** — `password_hash()` with `PASSWORD_DEFAULT` (bcrypt,
  salted) and `password_verify()`. Login does a constant-ish verification even
  for unknown users to reduce username enumeration via timing.
- **XSS** — all dynamic output is HTML-escaped via a single `e()` helper
  (`htmlspecialchars`, `ENT_QUOTES`). A strict **Content-Security-Policy**
  (`default-src 'self'`, no inline scripts) is also set.
- **CSRF** — a per-session token is required on **every** state-changing POST
  (register, login, logout, upload, delete), compared with `hash_equals()`.
- **Access control / IDOR** — image deletion is restricted to the owning user;
  the query is scoped by `user_id` and ownership is checked before acting.
- **Secure sessions** — cookies are `HttpOnly`, `SameSite=Lax`, and `Secure`
  under HTTPS; the session id is regenerated on creation and on login to
  prevent fixation.
- **Security headers** — CSP, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Resource-Policy`, and HSTS (under HTTPS).
- **No information leakage** — `display_errors` is off; uncaught errors are
  logged server-side and a generic 500 page is shown. No secrets are hardcoded;
  configuration is read from the environment.

### File-upload hardening

- **Allow-list by content, not filename** — the real MIME type is detected
  from the file bytes with `finfo` *and* cross-checked with `getimagesize()`.
  Only `image/jpeg`, `image/png`, `image/gif`, `image/webp` are accepted; the
  client-supplied filename and `Content-Type` are ignored.
- **Size limit** — uploads above `MAX_UPLOAD_BYTES` are rejected.
- **Random server-generated names** — files are stored as
  `<16 random bytes hex>.<ext>` (plus a `_thumb` variant). The original
  filename is never used on disk.
- **Stored outside the web root** — uploads live in `storage/uploads/`, which
  the dev-server router refuses to serve. Files are written `0644` (non-exec)
  and streamed back through `/image/{id}` and `/thumb/{id}` with a fixed,
  allow-listed `Content-Type` and `nosniff`.
- **Path-traversal containment** — any filename is validated against the
  expected pattern and resolved with `realpath()`, then confirmed to live
  inside the upload directory before it is read or deleted.

---

## License

MIT.
