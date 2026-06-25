# PHP Photo Blog

A small PHP photo blog where registered users can publish image posts with captions. The public feed is newest-first, and authors can edit or delete only their own posts.

## Run locally on port 5050

Requirements: PHP 8.2+ with `pdo_sqlite`, `fileinfo`, and `mbstring`.

```bash
composer install
APP_KEY="replace-with-a-long-random-secret" SESSION_SECURE=false composer run serve
```

Then open `http://127.0.0.1:5050`.

For production, serve only the `public/` directory, keep `APP_KEY` secret, use HTTPS, and leave `SESSION_SECURE` enabled. The SQLite database and uploads are stored under `storage/`, outside the public web root.
