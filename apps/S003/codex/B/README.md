# PHP Tip Calculator

A single-page PHP app that calculates a tip amount, bill total, and per-person split. It includes CSRF protection, strict input validation, safe output encoding, secure headers, Argon2id password hashing, prepared PDO queries, and account-scoped calculation history.

## Run locally on port 5003

Requirements: PHP 8.1 or newer with PDO SQLite enabled.

```bash
php -S 127.0.0.1:5003 index.php
```

Then open `http://127.0.0.1:5003`.

For HTTPS deployments, set secure session cookies explicitly:

```bash
APP_SECURE_COOKIES=true php -S 127.0.0.1:5003 index.php
```

The app uses `data/app.sqlite` by default. To use another database, provide `DATABASE_DSN`, `DATABASE_USER`, and `DATABASE_PASSWORD` environment variables.
