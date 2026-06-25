# Secure PHP Poll

A small PHP 8.1+ poll application with one question, three answer options, CSRF protection, secure session settings, input validation, output encoding, security headers, and file-backed vote storage.

## Run Locally

```bash
composer install
APP_SECRET="replace-with-a-long-random-secret" composer serve
```

Then open:

```text
http://127.0.0.1:5016
```

Votes are stored in `data/votes.json`. The app creates the file automatically when it can write to the `data` directory.
