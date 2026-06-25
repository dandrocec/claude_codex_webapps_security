# Text Metrics PHP App

A small PHP web app that accepts a block of text and reports the number of characters, words, and lines. Submitted text is echoed back with HTML encoding for reference.

## Run Locally

Requires PHP 8.1+ with PDO SQLite enabled.

```bash
APP_SECRET="replace-with-a-long-random-secret" APP_COOKIE_SECURE=0 php -S 127.0.0.1:5006 -t public
```

Open:

```text
http://127.0.0.1:5006
```

For production, run behind HTTPS and leave `APP_COOKIE_SECURE` enabled or set it to `1`.

## Security Notes

The app uses prepared PDO statements, Argon2id password hashing, CSRF tokens on POST requests, per-user ownership checks for saved analyses, input validation, context-aware HTML output encoding, secure session cookie settings, security headers, environment-based secrets, and generic error responses.
