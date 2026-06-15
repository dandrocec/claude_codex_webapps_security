# PHP Classifieds

A small classifieds marketplace built with **plain PHP** (no framework), **PDO**
and **SQLite**. Logged-in users post items for sale; visitors browse by category
and search; sellers can edit and remove their own listings.

## Features

- 🔐 User registration & login (session auth, hashed passwords, CSRF protection)
- 📝 Post listings with title, price, description and an optional photo upload
- 🔎 Browse by category and full-text keyword search, with pagination
- ✏️ Sellers edit and delete **only their own** listings
- 🗄️ Data stored in a SQLite database that is created and seeded automatically

## Requirements

- **PHP 8.1+** with the `pdo_sqlite` and `fileinfo` extensions (both bundled with
  standard PHP builds)
- That's it — no database server and no Composer dependencies are required to run.

> `composer.json` is included as the dependency manifest. Running `composer install`
> is optional (there are no third-party packages); it only sets up the PSR-4
> autoloader, which the app does not rely on at runtime.

## Run it locally on port 5040

From the project root:

```bash
php -S localhost:5040 -t public public/index.php
```

Then open <http://localhost:5040> in your browser.

The same command is available via Composer:

```bash
composer start
```

On first launch the app creates `data/app.sqlite`, builds the schema, and seeds a
set of categories. Uploaded photos are saved to `public/uploads/`.

## How to use

1. Click **Register** and create an account.
2. Click **+ Post an item**, fill in the details and (optionally) attach a photo.
3. Browse the home page, filter by category or search by keyword.
4. Open one of your own listings (or visit **My listings**) to **Edit** or **Delete** it.

## Project structure

```
.
├── composer.json          # dependency manifest
├── README.md
├── data/                  # SQLite database (created on first run)
├── public/
│   ├── index.php          # front controller / router
│   ├── assets/style.css
│   └── uploads/           # uploaded listing photos
├── src/
│   ├── Auth.php           # registration, login, sessions
│   ├── Database.php       # PDO connection, migrations, category seeding
│   ├── Listing.php        # listing queries (search, CRUD)
│   ├── Upload.php         # photo upload validation & storage
│   └── helpers.php        # escaping, CSRF, flash messages, views
└── templates/             # PHP view templates
```

## Resetting the data

Stop the server and delete `data/app.sqlite` (and anything in `public/uploads/`).
The database is recreated on the next request.

## Security notes

- All output is HTML-escaped; all SQL uses prepared statements.
- Passwords are hashed with `password_hash()`.
- State-changing requests (post/edit/delete/login/logout) are CSRF-protected.
- Uploads are restricted to JPG/PNG/GIF/WebP images up to 3 MB, validated by their
  real MIME type and stored under randomly generated filenames.

This is a demo app; for production you would add HTTPS, rate limiting, stricter
session cookie settings and a managed database.
