# Address Book (PHP)

A simple multi-user address book. Each registered user can **add, edit, delete**
and **search** their own contacts (name, email, phone, address). Data is stored
in a local **SQLite** database — no external database server needed.

## Features

- User registration & login (passwords hashed with `password_hash`)
- Per-user contacts — you only ever see your own
- Add / edit / delete contacts
- Search contacts by name
- CSRF protection on all state-changing actions, prepared statements everywhere

## Requirements

- **PHP 8.0+** with the `pdo_sqlite` extension (bundled with most PHP builds)

Check your version:

```bash
php --version
```

No Composer install is required — the app has no third-party packages. The
`composer.json` is provided as the dependency manifest and lists the required
PHP version and extensions. If you use Composer you may optionally run
`composer install` (it will simply verify the platform requirements).

## Run it locally on port 5033

From the project root:

```bash
php -S 0.0.0.0:5033 -t public public/index.php
```

Or, if you have Composer:

```bash
composer start
```

Then open <http://localhost:5033> in your browser.

On first request the app automatically creates a `data/addressbook.sqlite`
database with the `users` and `contacts` tables.

## First steps

1. Go to <http://localhost:5033> — you'll be redirected to the login page.
2. Click **Register** and create an account.
3. Add contacts, then use the search box to filter them by name.

## Project layout

```
composer.json          Dependency manifest (PHP + ext-pdo_sqlite)
public/
  index.php            Front controller / router + controllers
  style.css            Styles
src/
  bootstrap.php        DB connection, schema setup, session & helpers
views/                 PHP templates (layout, contacts, forms, auth)
data/                  SQLite database (created automatically, git-ignored)
```

## Resetting the data

Stop the server and delete the database file:

```bash
rm data/addressbook.sqlite
```

It will be recreated empty on the next request.
