# Base64 Tool

A small PHP app with a form for Base64 encoding and decoding text.

## Run locally

Requirements:

- PHP 8.1 or newer
- Composer, if you want to use the provided script

Start the app on port 5021:

```bash
composer run serve
```

Or run it directly with PHP:

```bash
php -S 127.0.0.1:5021 -t public
```

Open http://127.0.0.1:5021 in your browser.

## Configuration

The app does not persist data and does not require secrets. If database-backed features are added, configure connection values through environment variables instead of hardcoding them:

- `DATABASE_DSN`
- `DATABASE_USER`
- `DATABASE_PASSWORD`

Security controls include CSRF protection, strict input validation, context-aware output escaping, hardened session cookie settings, security headers, generic client-facing errors, prepared-statement database helper code, Argon2id password hashing helpers, and an ownership-check helper for future user-owned resources.
