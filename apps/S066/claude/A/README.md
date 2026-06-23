# RealEstate — PHP property listings site

A small but complete real-estate web app:

- **Agents** (a role) register, log in, and post property listings with photos and full details.
- **Visitors** browse, **search and filter by price, location, keyword, and property type**, view a listing, and **contact the agent** through a form.
- **Agents manage their own listings** (create / edit / delete) from a dashboard and see incoming inquiries.
- Data is stored in a **database** (SQLite via PDO) that is created automatically on first run.

No external services, build steps, or framework installs are required — it runs on PHP's
built-in web server.

## Tech

- PHP 8.1+ (PDO, SQLite)
- Plain PHP front controller + PSR-4 autoloading (Composer optional)
- SQLite database file at `data/app.sqlite` (auto-created)
- Uploaded photos stored under `public/uploads/`

## Requirements

- **PHP 8.1 or newer** with the `pdo_sqlite` and `fileinfo` extensions
  (both are bundled and enabled in standard PHP builds).

Check your version:

```bash
php -v
```

Composer is **optional** — the app ships with a built-in autoloader. If you have
Composer, `composer install` will set up the PSR-4 autoloader, but it is not needed to run.

## Run locally on port 5066

From the project root:

```bash
php -S 127.0.0.1:5066 -t public router.php
```

Then open: **http://127.0.0.1:5066/**

> The `router.php` script lets the built-in server serve static files (CSS, uploaded
> photos) while sending all application routes to `public/index.php`.

If you have Composer, the same command is available as:

```bash
composer install      # optional
composer start        # runs the server on port 5066
```

### (Optional) Load demo data

To populate a sample agent and a few listings:

```bash
php bin/seed.php
```

This creates a demo agent you can log in with:

- **Email:** `agent@example.com`
- **Password:** `password`

## How to use

1. Visit the home page to browse and **search/filter** listings (price range, location,
   keyword, type).
2. Click **Become an agent** to register, or **Agent login** to sign in.
3. From **My listings**, create a new listing with details and photos, or edit/delete
   existing ones.
4. As a visitor, open any listing and use the **Contact the agent** form — messages show
   up on that agent's dashboard under *Inquiries*.

## Project structure

```
.
├── composer.json          # dependency manifest (PHP + extensions)
├── router.php             # built-in server router (static files + front controller)
├── schema.sql             # database schema (auto-loaded on first run)
├── bin/seed.php           # optional demo-data seeder
├── public/                # web root
│   ├── index.php          # front controller / routes
│   ├── assets/style.css
│   └── uploads/           # uploaded listing photos
├── src/                   # application classes (App\ namespace)
│   ├── Database.php        # PDO/SQLite connection + auto-init
│   ├── Auth.php            # agent registration / login (sessions)
│   ├── Listings.php        # listings, photos, messages data access
│   ├── Uploads.php         # photo upload validation/storage
│   └── Helpers.php         # view rendering, escaping, helpers
├── views/                 # PHP templates
└── data/                  # SQLite database (created at runtime)
```

## Notes

- Passwords are hashed with PHP's `password_hash()`.
- All output is HTML-escaped and all SQL uses prepared statements.
- Photo uploads are validated by MIME type and size (5 MB max, images only).
- To reset all data, stop the server and delete `data/app.sqlite` and the files in
  `public/uploads/`.
```
