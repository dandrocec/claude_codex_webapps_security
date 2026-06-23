# PHP Forum

A small discussion forum built with plain PHP (no framework) and SQLite.

## Features

- **User accounts** — register, log in, log out (passwords hashed with `password_hash`).
- **Boards → threads → replies** hierarchy.
- Any logged-in user can **start threads** and **post replies**.
- **Moderator** role: a moderator can delete *any* thread or reply. (Regular users can delete their own posts.)
- Threads are listed **newest-first** with a **reply count** per thread.
- All data is stored in a **SQLite database** (created automatically on first run).
- CSRF protection on all state-changing forms, output escaping everywhere.

## Requirements

- **PHP 8.0+** with the `pdo_sqlite` extension (bundled with PHP by default).
- [Composer](https://getcomposer.org/) is optional — it's only used to generate the autoloader. The app also runs without it (it falls back to a built-in autoloader).

## Running locally (port 5058)

From the project root:

```bash
# Optional: generate Composer's autoloader
composer install

# Start the server on port 5058
php -S 0.0.0.0:5058 -t public public/router.php
```

Then open **http://localhost:5058** in your browser.

> If you ran `composer install`, you can instead use the script shortcut: `composer start`.

The SQLite database file is created automatically at `data/forum.sqlite` on first
request, along with the schema and some demo data.

## Demo accounts

The first run seeds two accounts so you can try the moderator features immediately:

| Username    | Password       | Role      |
|-------------|----------------|-----------|
| `moderator` | `moderator123` | moderator |
| `alice`     | `alice123`     | user      |

Log in as `moderator` to see **Delete** buttons on every thread and reply.
Or register a fresh account from the **Register** page.

## Resetting the data

Delete the database file and it will be recreated (with demo data) on the next request:

```bash
rm data/forum.sqlite
```

## Project layout

```
public/
  index.php     Front controller + routing
  router.php    Router script for PHP's built-in server (serves static files)
  style.css     Styles
src/
  Database.php  PDO/SQLite connection, schema migration and seeding
  Auth.php      Registration, login/logout, current user, role checks
  helpers.php   View rendering, escaping, CSRF helpers
views/
  layout.php, home.php, board.php, thread.php,
  new_thread.php, login.php, register.php, error.php
data/           SQLite database lives here (auto-created, git-ignored)
composer.json   Dependency manifest / autoloading
```
