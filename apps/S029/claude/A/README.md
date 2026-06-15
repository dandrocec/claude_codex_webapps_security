# PHP Guestbook

A minimal guestbook. Visitors leave a **name** and a **message**; entries are
stored in a database and shown on the main page **newest-first**.

- **Language:** PHP (8.0+)
- **Storage:** SQLite via PDO — created automatically, no DB server to set up
- **Dependencies:** none beyond PHP and its bundled SQLite/PDO extensions

## Requirements

- PHP 8.0 or newer with the `pdo_sqlite` extension (bundled by default in
  standard PHP builds — including the Windows ZIP and most Linux/macOS packages).

Check your install:

```bash
php --version
php -m | grep -i pdo_sqlite      # should list "pdo_sqlite"
```

## Run it locally on port 5029

From the project directory, start PHP's built-in web server:

```bash
php -S localhost:5029
```

Then open <http://localhost:5029> in your browser.

If you use Composer, the same command is wired up as a script:

```bash
composer start
```

> The SQLite database file is created automatically at `data/guestbook.sqlite`
> on first request. To reset the guestbook, just delete that file.

## Project layout

| File           | Purpose                                                     |
| -------------- | ----------------------------------------------------------- |
| `index.php`    | Front controller: renders the form + message list, handles POST |
| `db.php`       | Opens the SQLite connection and ensures the schema exists   |
| `composer.json`| Dependency manifest (PHP + SQLite/PDO extensions)           |
| `data/`        | Holds the auto-created SQLite database (created at runtime) |

## Notes

- Input is validated (name and message are required, with length limits) and all
  output is HTML-escaped to prevent XSS.
- Submissions use the Post/Redirect/Get pattern, so refreshing the page after
  posting won't resubmit the message.
