# Base64 Encoder / Decoder (PHP)

A small PHP web app with a single form: enter text, pick **Encode** or **Decode**,
and submit to get the Base64-encoded or decoded result.

## Requirements

- PHP **8.1+** (uses the built-in web server; no database required)
- [Composer](https://getcomposer.org/) — optional, only used for the autoloader/start script

Verify PHP is installed:

```sh
php --version
```

## Run locally on port 5021

The app is served from the `public/` directory as the document root.

**Option A — using the Composer script:**

```sh
composer install        # sets up the PSR-4 autoloader (no third-party deps)
composer start          # serves on http://127.0.0.1:5021
```

**Option B — plain PHP (no Composer needed):**

```sh
php -S 127.0.0.1:5021 -t public
```

Then open <http://127.0.0.1:5021> in your browser.

> Optional: copy `.env.example` to `.env`. The app reads configuration from the
> environment and hardcodes no secrets. To pass an env var to the built-in
> server, set it before the command, e.g. `TRUST_PROXY=1 php -S 127.0.0.1:5021 -t public`.

## Project layout

```
public/index.php          Front controller + HTML form/view
src/bootstrap.php          Autoloader, session hardening, security headers
src/Csrf.php               Synchronizer-token CSRF protection
src/Base64Service.php      Encode/decode logic with strict validation
src/InvalidInputException.php
composer.json              Dependency manifest
```

## Security notes (OWASP Top 10)

This is a **stateless tool with no database and no user accounts**, so a few
OWASP controls do not apply and are intentionally absent:

- **SQL injection / parameterised queries** — N/A: no database or SQL is used.
- **Password hashing (bcrypt/Argon2)** — N/A: there is no authentication or stored
  credential. (If accounts were added, `password_hash(..., PASSWORD_ARGON2ID)`
  would be the implementation.)
- **Access control / IDOR** — N/A: there are no per-user resources to authorize.

The controls that **do** apply are implemented:

- **CSRF protection** — a per-session synchronizer token is required on the POST
  and validated with a constant-time comparison (`src/Csrf.php`).
- **XSS / output encoding** — all dynamic output is HTML-escaped with
  context-aware `htmlspecialchars(ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')`.
- **Input validation** — direction is allow-listed (`encode`/`decode`), input is
  size-limited (100 KB), and decoding uses strict Base64 validation.
- **Secure session cookies** — `HttpOnly`, `SameSite=Strict`, and `Secure` (when
  served over HTTPS).
- **Security headers** — strict `Content-Security-Policy` (`default-src 'none'`),
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, and `HSTS` over HTTPS.
- **No error leakage** — `display_errors` is off; unexpected errors are logged
  server-side and a generic message is shown to the client.
- **No hardcoded secrets** — configuration is read from environment variables.

### A note on HTTPS in production

The built-in server runs plain HTTP for local development, so the `Secure` cookie
flag and HSTS activate only when the app is served over HTTPS (e.g. behind a TLS
reverse proxy). Run it behind nginx/Apache with TLS in production and set
`TRUST_PROXY=1` so the app recognizes `X-Forwarded-Proto: https`.
