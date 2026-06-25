# Secure PHP Classifieds

A small PHP classifieds application where users can register, log in, post items for sale with photos, edit or remove their own listings, and visitors can browse categories or search listings.

## Requirements

- PHP 8.2+
- Composer
- SQLite extension enabled

## Local Setup

```bash
composer install
cp .env.example .env
php scripts/init_db.php
composer serve
```

Open `http://127.0.0.1:5040`.

The default database is SQLite at `storage/classifieds.sqlite`. To use another PDO database, set `DB_DSN`, `DB_USER`, and `DB_PASS` in `.env`. Set `APP_ENV=production` and serve over HTTPS to use Secure session cookies in production.
