# PHP Contact Form

A small, self-contained contact form. Visitors submit **name, email, message**;
each submission is appended to a local file and a thank-you page is shown. A
second page lists every submission received so far.

No database and no third-party packages are required — it runs on PHP's built-in
web server.

## Requirements

- PHP **8.1+** with the `json` and `mbstring` extensions (both bundled with
  standard PHP builds). See `composer.json`.
- Composer is **not** required to run the app; it's only used here to declare
  the runtime requirements and provide handy scripts.

## Run it locally on port 5012

The document root must be the `public/` directory (this keeps `src/` and the
stored data out of the web root).

```bash
cd contact-app
php -S 127.0.0.1:5012 -t public
```

Then open:

- **Contact form:**  http://127.0.0.1:5012/index.php
- **Submissions list:** http://127.0.0.1:5012/submissions.php

If you have Composer installed you can use the shortcut instead:

```bash
composer start    # runs: php -S 127.0.0.1:5012 -t public
```

Submissions are written to `data/submissions.jsonl` (one JSON object per line),
created automatically on first submit.

## Configuration (environment variables)

No secrets are required to run locally. Optional settings (see `.env.example`):

| Variable        | Default                     | Purpose                                            |
| --------------- | --------------------------- | -------------------------------------------------- |
| `COOKIE_SECURE` | auto (on when HTTPS)        | Force the `Secure` flag on the session cookie.     |
| `SESSION_NAME`  | `CONTACTSESSID`             | Session cookie name.                               |
| `DATA_FILE`     | `./data/submissions.jsonl`  | Where submissions are stored.                      |

Copy `.env.example` to `.env` for local overrides, or set real environment
variables in production. `.env` is git-ignored.

> On plain-HTTP `localhost`, leave `COOKIE_SECURE` unset/`0`. In production
> behind HTTPS, set `COOKIE_SECURE=1`.

## Security notes

OWASP Top 10 best practices applied to this app:

- **XSS (A03):** every dynamic value is escaped with context-aware output
  encoding (`htmlspecialchars`, `ENT_QUOTES`, UTF-8) at render time; message
  line breaks are rendered with `nl2br` *after* escaping. A strict
  `Content-Security-Policy` (no inline/remote scripts) provides defence in depth.
- **Input validation (A03):** all fields are trimmed, control characters are
  stripped, lengths are bounded, and the email is validated with
  `filter_var(FILTER_VALIDATE_EMAIL)`.
- **CSRF (A01):** every state-changing POST carries a per-session synchronizer
  token, compared with `hash_equals`; the session cookie is also `SameSite=Lax`.
- **Secure session cookies (A07):** `HttpOnly`, `SameSite=Lax`, and `Secure`
  (auto over HTTPS, forceable via `COOKIE_SECURE`).
- **Security headers (A05):** CSP, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and HSTS
  over HTTPS.
- **No information leakage (A05/A09):** `display_errors` is off; exceptions are
  logged and the client gets a generic error page — never a stack trace.
- **No hardcoded secrets (A05):** configuration is read from the environment
  (`.env` for local dev only, and git-ignored).
- **Safe storage:** the data file lives outside the web root and writes/reads
  are guarded with `flock`. Records are stored as JSON Lines, which sidesteps
  CSV formula-injection issues.

### Requirements that don't apply to this app

Some items in the brief assume a database and user accounts, which this
file-based, unauthenticated contact form does not have:

- **SQL injection / parameterised queries** — there is no SQL database. Storage
  is an append-only JSON Lines file; values are never interpolated into a query
  language. (If you add a DB later, use PDO prepared statements.)
- **Password hashing (bcrypt/Argon2)** — there are no passwords or login. (If
  you add auth, hash with `password_hash($pw, PASSWORD_ARGON2ID)`.)
- **Access control / IDOR** — there are no per-user resources to protect. The
  submissions page is intentionally public; if it should be restricted, put it
  behind authentication and authorise per role before adding that feature.

## Project layout

```
contact-app/
├── public/              # web root (point the server here)
│   ├── index.php        # contact form + POST handler
│   ├── thanks.php       # thank-you confirmation (Post/Redirect/Get)
│   ├── submissions.php  # lists all submissions
│   └── style.css
├── src/
│   ├── bootstrap.php     # session, headers, CSRF, escaping, error handling
│   └── Storage.php       # file-based, locked JSON Lines store
├── data/                 # created at runtime (git-ignored)
├── composer.json
├── .env.example
└── README.md
```
