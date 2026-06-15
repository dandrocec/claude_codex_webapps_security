# Quotes App

A small PHP application where logged-in users submit quotes (text + author),
and a public page lists all **approved** quotes with an author filter.
Submitters can edit their own quotes; admins approve what appears publicly.

Built with plain PHP 8 and **SQLite** — no database server to install and no
third-party packages to download. The database file, schema, and a few demo
records are created automatically the first time you run it.

## Features

- Register / log in (session-based auth, hashed passwords).
- Logged-in users submit quotes; new submissions wait for approval.
- Public browse page lists approved quotes and filters by author.
- Submitters can edit their own quotes (editing re-queues them for review).
- Admin review queue to approve pending quotes.
- CSRF protection on every form; all output is HTML-escaped.

## Requirements

- PHP **8.1+** with the `pdo` and `pdo_sqlite` extensions (both bundled with
  standard PHP builds — `php -m` should list `pdo_sqlite`).
- Composer is **optional** — there are no runtime dependencies to install.

## Run locally on port 5046

From the project root:

```bash
php -S 0.0.0.0:5046 -t public public/router.php
```

Or, if you have Composer installed, the same command is wired up as a script:

```bash
composer start
```

Then open <http://localhost:5046>.

## Demo accounts

The first run seeds two accounts and a few sample quotes:

| Username | Password   | Role            |
|----------|------------|-----------------|
| `admin`  | `admin123` | Admin (approve) |
| `alice`  | `alice123` | Submitter       |

## Try it

1. Open <http://localhost:5046> — you'll see the seeded approved quotes and can
   filter by author.
2. Log in as `alice` and submit a new quote. It shows as **Pending review** on
   your *My quotes* page and does **not** appear publicly yet.
3. Log in as `admin`, open **Review**, and approve it — it now appears on the
   public page.
4. As `alice`, edit one of your quotes; it goes back to the review queue.

## Project layout

```
composer.json        Dependency manifest (PHP + ext-pdo_sqlite)
schema.sql           SQLite schema, applied automatically on first run
public/
  index.php          Front controller / router
  router.php         Router script for PHP's built-in server
  style.css          Styles
src/
  Database.php       PDO/SQLite connection, migration & seeding
  Auth.php           Session auth (login, register, guards)
  Quote.php          Quote queries (list, filter, create, edit, approve)
  helpers.php        Escaping, CSRF, flash, redirect helpers
  views/             Templates rendered inside views/layout.php
data/                SQLite database file (created on first run)
```

## Resetting the data

Delete `data/quotes.sqlite` and restart the server — it will be recreated and
re-seeded.
