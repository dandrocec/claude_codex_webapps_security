# PHP Guestbook

A small database-backed guestbook. Visitors register, sign in, leave a name and message, and see entries newest-first on the main page. Signed-in users can delete only their own messages.

## Requirements

- PHP 8.1 or newer
- Composer
- PDO SQLite extension

## Run Locally on Port 5029

```bash
composer install
cp .env.example .env
php -S 127.0.0.1:5029 -t public
```

Then open `http://127.0.0.1:5029`.

The app creates the SQLite database automatically at the path configured by `DB_PATH`.

## Configuration

Environment variables are loaded from `.env` for local development:

- `APP_ENV`: use `development` locally
- `APP_SECRET`: random application secret used for CSRF token binding
- `DB_PATH`: SQLite database path
- `SESSION_SECURE`: set `0` for local HTTP, `1` behind HTTPS

Do not commit real production secrets.
