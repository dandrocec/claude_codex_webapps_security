# PHP Classifieds

A lightweight classifieds site where visitors can browse listings by category and search, while logged-in sellers can post, edit, and delete their own items.

## Requirements

- PHP 8.1 or newer
- PDO SQLite extension enabled
- Composer

## Run locally on port 5040

```bash
composer install
composer start
```

Then open:

```text
http://127.0.0.1:5040
```

The app creates its SQLite database automatically at `database/classifieds.sqlite` on first run.
