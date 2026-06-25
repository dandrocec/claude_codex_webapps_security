# PHP Guestbook

A small PHP guestbook where visitors can leave a name and message. Entries are stored in a SQLite database and shown newest-first.

## Run Locally

Requirements:

- PHP 8.1 or newer
- PDO SQLite extension enabled

Start the app on port 5029:

```bash
composer start
```

Or run PHP directly:

```bash
php -S 127.0.0.1:5029 -t public
```

Then open `http://127.0.0.1:5029`.

The SQLite database is created automatically at `data/guestbook.sqlite`.
