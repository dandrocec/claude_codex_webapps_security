# PHP Address Book

A secure PHP address book where logged-in users manage their own contacts.

## Run Locally

Requirements: PHP 8.1+ with PDO SQLite enabled.

```bash
composer install
APP_ENV=local SESSION_COOKIE_SECURE=false php -S 127.0.0.1:5033 -t public
```

Then open `http://127.0.0.1:5033`.

The app stores SQLite data at `storage/address_book.sqlite` by default. Override this with:

```bash
DATABASE_DSN="sqlite:/absolute/path/address_book.sqlite"
```

For production, set `APP_ENV=production`, serve over HTTPS, and leave `SESSION_COOKIE_SECURE=true`.
