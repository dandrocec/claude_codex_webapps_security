# PHP Email Subscription

A minimal PHP application with an email-subscription form. On submit, the email
is stored in a SQLite database and a confirmation message is shown. A second
page lists every subscribed address.

## Features

- Subscription form with server-side email validation
- Confirmation message after subscribing
- Duplicate addresses are handled gracefully (UNIQUE constraint)
- Subscribers list page (newest first)
- Stores data in SQLite — no database server to set up

## Requirements

- **PHP 8.0+** with the `pdo` and `pdo_sqlite` extensions (both ship with
  standard PHP builds).

No third-party packages are required, so you do **not** need to run
`composer install`. The `composer.json` is provided as the dependency manifest
and documents the runtime requirements.

Check your PHP version:

```bash
php -v
```

## Run it locally (port 5025)

From the project root, start PHP's built-in web server:

```bash
php -S localhost:5025 -t public
```

Or, if you have Composer installed, use the bundled script:

```bash
composer start
```

Then open:

- **Subscribe form:** http://localhost:5025/
- **Subscribers list:** http://localhost:5025/subscribers.php

## Project structure

```
.
├── public/
│   ├── index.php         # Subscription form + submit handling
│   └── subscribers.php   # Lists all subscribed addresses
├── src/
│   ├── db.php            # SQLite connection + schema bootstrap
│   └── layout.php        # Shared HTML layout + escaping helper
├── data/                 # SQLite database (created automatically)
├── composer.json
└── README.md
```

The SQLite database is created automatically at `data/subscribers.sqlite` the
first time the app runs. To reset all data, simply delete that file.
