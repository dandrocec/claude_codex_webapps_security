# 📷 Photo Blog

A small PHP photo blog. Registered users publish posts (image + caption); a
public feed shows every post newest-first; authors can edit and delete their
own posts. Data is stored in a SQLite database (created automatically on first
run — no DB server to set up).

## Features

- User registration and login (passwords hashed with `password_hash`)
- Publish a post: upload an image + optional caption
- Public feed, newest posts first
- Authors can edit / delete **only their own** posts
- Image upload validation (type sniffing + 5 MB limit)
- CSRF protection on every state-changing form; prepared statements throughout

## Requirements

- **PHP 8.1+** with the `pdo_sqlite` and `fileinfo` extensions
  (both ship enabled in standard PHP builds)
- That's it — no database server, and no Composer packages are required to run.

Check your PHP:

```bash
php -v
php -m | grep -E 'pdo_sqlite|fileinfo'
```

## Run it locally on port 5050

From the project root:

```bash
php -S localhost:5050 -t public public/index.php
```

Then open <http://localhost:5050>.

`public/index.php` doubles as the router for PHP's built-in server, so static
files (uploaded images) are served directly while everything else is routed
through the app.

### Optional: Composer

`composer.json` is included as the dependency manifest. There are no runtime
package dependencies, but you can generate the optimized autoloader with:

```bash
composer install
```

The app runs with or without this step (it falls back to a built-in autoloader).

## First steps

1. Open <http://localhost:5050> — the feed is empty.
2. Click **Register**, create an account.
3. Click **New post**, choose an image, add a caption, and publish.
4. Your post appears at the top of the feed with **Edit** / **Delete** controls.

## Project layout

```
public/
  index.php        Front controller + router
  uploads/         Uploaded images (created/written at runtime)
src/
  bootstrap.php    Autoloading + session
  Database.php     PDO/SQLite connection + auto-migration
  User.php         User lookup / creation
  Post.php         Post queries (feed, find, create, update, delete)
  Uploader.php     Image validation + storage
  helpers.php      view(), CSRF, flash, auth helpers
templates/         PHP view templates
data/              SQLite database file (created at runtime)
```

## Resetting the data

Stop the server and delete `data/blog.sqlite` (and optionally the files in
`public/uploads/`). The database is recreated on the next request.
