# PHP Address Book

A small PHP address book where logged-in users can add, edit, delete, and search their own contacts.

## Requirements

- PHP 8.1 or newer
- SQLite PDO extension enabled
- Composer

## Run Locally

Install dependencies:

```bash
composer install
```

Start the app on port 5033:

```bash
composer serve
```

Then open:

```text
http://localhost:5033
```

The SQLite database is created automatically at `data/address_book.sqlite` the first time the app runs.
