# PHP Poll

A tiny, security-hardened polling app: one question, three options. Visitors
pick an option and submit; votes are stored in a JSON file and the live tally
(counts + percentages) is shown to everyone.

No database and no external runtime dependencies — it runs on a stock PHP
installation.

## Requirements

- PHP **7.4+** (with the bundled `json` extension — enabled by default)
- [Composer](https://getcomposer.org/) *(optional — only needed for the
  `composer start` shortcut and the PSR-4 autoloader)*

## Run locally on port 5016

From the project root:

```bash
# 1. Configure environment (optional but recommended)
cp .env.example .env
#    For plain-HTTP localhost, leave COOKIE_SECURE unset/false.
#    For production, set APP_ENV=production and a strong APP_SECRET.

# 2. Start PHP's built-in web server with the public/ dir as the web root
php -S localhost:5016 -t public
```

Or, if you have Composer installed:

```bash
composer install   # sets up the autoloader (no third-party packages are pulled)
composer start     # == php -S localhost:5016 -t public
```

Then open <http://localhost:5016> in your browser.

The vote tally is created automatically at `data/votes.json` on first use.
To reset the poll, stop the server and delete that file.

## Project layout

```
config/config.php   Configuration + .env loader (secrets come from the env)
public/index.php    Front controller (the only web-reachable PHP entry point)
public/style.css    Styles (no inline styles, to satisfy a strict CSP)
src/Security.php    Session hardening, security headers, CSRF, output encoding
src/VoteStore.php   Concurrency-safe (flock) file-backed vote tally
data/               Runtime vote storage — kept OUTSIDE the web root
```

## Security measures (OWASP Top 10)

This app applies the OWASP Top 10 controls that are relevant to its scope. A
few mandated controls concern features this app does not have; those are noted
honestly rather than bolted on for show.

| Control | How it is addressed |
| --- | --- |
| **Injection** | The vote storage is a JSON file, not SQL — there is no query language to inject into. Input is matched against a server-side **whitelist** of option keys before use, and JSON is encoded/decoded via the hardened `json_*` functions. |
| **XSS** | All dynamic output is escaped with context-aware `htmlspecialchars` (`ENT_QUOTES`, UTF-8). A strict **Content-Security-Policy** (`default-src 'self'`, no `unsafe-inline`) blocks injected scripts/styles as defence in depth. |
| **CSRF** | Every state-changing `POST` requires a per-session, cryptographically-random token verified in constant time (`hash_equals`). `SameSite=Strict` cookies add a second layer. |
| **Broken access control / IDOR** | Voting state is tracked **server-side** in the session, not via client-supplied IDs. A visitor can cast exactly one vote and cannot read or alter another visitor's vote. |
| **Security misconfiguration / headers** | Sends `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, and `Permissions-Policy`; removes `X-Powered-By`. |
| **Secure session cookies** | Session cookies are set `HttpOnly`, `SameSite=Strict`, and `Secure` (auto-detected for HTTPS / forced via `COOKIE_SECURE`). Strict-mode, cookies-only sessions with ID regeneration to resist fixation. |
| **Sensitive data / error handling** | A global exception + error handler logs details server-side and returns a **generic** message to clients. Verbose errors appear only when `APP_ENV=development`. |
| **Secrets management** | No secrets are hardcoded. `APP_SECRET` and all settings are read from environment variables (via a real env var or a local `.env` that is git-ignored). |
| **Data integrity (concurrency)** | Vote writes hold an exclusive `flock` and rewrite under the lock, so simultaneous votes are never lost or corrupted. |

### Not applicable to this app

- **Parameterised SQL queries** — requested in the brief, but this app
  deliberately uses flat-file storage and contains no SQL database, so there
  are no queries to parameterise. The equivalent risk (untrusted input
  reaching the data layer) is handled with strict input whitelisting.
- **Password hashing (bcrypt/Argon2)** — there is no user authentication or
  account system in a public, anonymous poll, so there are no passwords to
  hash. If accounts were added, use `password_hash()` with `PASSWORD_ARGON2ID`
  (or `PASSWORD_BCRYPT`) and `password_verify()`.

## Notes for production

- Set `APP_ENV=production` and a strong `APP_SECRET`.
- Serve over HTTPS (a reverse proxy is fine); the `Secure` cookie flag then
  applies automatically, or set `COOKIE_SECURE=true`.
- Point your web server's document root at `public/` so only the front
  controller and static assets are reachable; `data/`, `src/`, and `config/`
  stay private.
