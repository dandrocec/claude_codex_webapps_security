# PHP Contact Form

A minimal contact form built with plain PHP. Submissions (name, email, message)
are appended to a local file and can be browsed on a separate page.

## Features

- **Contact form** (`index.php`) with server-side validation.
- **Thank-you page** (`submit.php`) shown after a successful submission.
- **Submissions list** (`list.php`) showing every message received, newest first.
- Data is stored as JSON-lines in `data/submissions.jsonl` — no database required.

## Requirements

- **PHP 7.4 or newer** (uses only the standard library — no Composer packages needed).
  Check with `php --version`.
- Composer is *optional* — it's only used here as a convenient way to launch the
  built-in server (see below). The app itself has no third-party dependencies.

## Running locally on port 5012

The app uses PHP's built-in web server. From the project directory, run **one** of:

```bash
# Plain PHP (no Composer required)
php -S 127.0.0.1:5012
```

```bash
# Or, via the Composer script
composer start
```

Then open <http://127.0.0.1:5012> in your browser.

- Fill in the form and submit → you'll see the thank-you page.
- Visit <http://127.0.0.1:5012/list.php> to see all submissions.

## Project layout

```
index.php      Contact form
submit.php     Validates + saves a submission, renders the thank-you page
list.php       Lists all submissions
storage.php    Shared save/load helpers
style.css      Styling
composer.json  Dependency manifest (PHP >= 7.4)
data/          Created automatically; holds submissions.jsonl
```

## Notes

- The `data/` directory and `submissions.jsonl` file are created automatically on
  the first submission.
- All user input is HTML-escaped on output to prevent XSS.
