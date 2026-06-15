# Text Analyzer (PHP)

A small PHP web app. Submit a block of text and it reports the number of
**characters**, **words**, and **lines**, and echoes the submitted text back for
reference.

## Requirements

- PHP **8.1+** with the `mbstring` extension (bundled in most PHP distributions)
- No database and no third-party packages are required.

`composer.json` is included as the dependency manifest. Running `composer
install` is optional — it only sets up the PSR-4 autoloader mapping; the app
ships with its own lightweight autoloader so it runs without Composer.

## Run locally on port 5006

From the project root:

```bash
# 1. (Recommended) set an app secret used to seed CSRF tokens
#    Generate one:  php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
# macOS/Linux:
export APP_KEY=your-generated-secret
# Windows PowerShell:
#   $env:APP_KEY = "your-generated-secret"

# 2. Start PHP's built-in web server, document root = public/
php -S 127.0.0.1:5006 -t public
```

Then open <http://127.0.0.1:5006> in your browser.

Or, with Composer installed, simply:

```bash
composer start
```

`APP_KEY` is optional for local use (a per-request CSPRNG value is used as a
fallback), but set it in any shared/production environment.

## Project layout

```
public/index.php   Front controller: form, request handling, HTML rendering
src/bootstrap.php  Autoloader + safe global error handling
src/Security.php   Security headers + hardened session cookies
src/Csrf.php       Synchronizer-token CSRF protection
src/TextStats.php  Character / word / line counting logic
src/Password.php   Password hashing helper (Argon2id/bcrypt) for future auth
.env.example       Documented environment variables
```

## Security measures (OWASP Top 10)

This app intentionally has **no database and no user accounts**, so SQL and
login surfaces don't exist to be attacked. The relevant controls are applied,
and the patterns for the rest are included so the app stays secure if extended.

| Requirement | How it's handled |
|---|---|
| **Injection / XSS (A03)** | All dynamic output goes through `htmlspecialchars()` with `ENT_QUOTES`, context-aware HTML encoding. Input is validated as UTF-8 and size-capped. |
| **SQL injection (A03)** | No SQL is used. If a DB is added, use **PDO prepared statements** with bound parameters — never string concatenation. |
| **CSRF (A01)** | Every state-changing POST requires a per-session synchronizer token, compared in constant time (`hash_equals`). |
| **Broken access control / IDOR (A01)** | No cross-user resources exist; the only state (CSRF token) is scoped to the caller's own session. |
| **Password storage (A07)** | `src/Password.php` hashes with **Argon2id** (falling back to **bcrypt**), with automatic per-password salting — ready for when auth is added. |
| **Secure session cookies (A05)** | `HttpOnly`, `SameSite=Strict`, and `Secure` (over HTTPS) set via `session_set_cookie_params`; strict-mode, cookie-only sessions. |
| **Security headers (A05)** | CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, COOP/CORP, `Permissions-Policy`, and HSTS over HTTPS. |
| **Error handling (A09)** | `display_errors` off; uncaught exceptions are logged and a generic message is shown — no stack traces reach the client. |
| **Secrets management (A02)** | `APP_KEY` is read from the environment, never hardcoded. |
| **Input validation** | Method check, type checks, UTF-8 validation, newline normalisation, and a 100 KB size cap to limit resource exhaustion. |
```
