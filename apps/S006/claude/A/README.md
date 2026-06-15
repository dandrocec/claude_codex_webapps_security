# Text Stats

A tiny PHP web app. Enter a block of text in the textarea and submit to see
the number of **characters**, **words**, and **lines**. The submitted text is
echoed back for reference.

## Requirements

- **PHP 7.4 or newer** with the `mbstring` extension (bundled with most PHP
  distributions). No framework or third-party packages are needed — the
  `composer.json` is provided for completeness and to declare these
  requirements.

Check your PHP version:

```bash
php --version
```

## Run it locally (port 5006)

From the project directory, start PHP's built-in web server:

```bash
php -S localhost:5006
```

Or, if you have Composer installed, use the bundled script:

```bash
composer start
```

Then open <http://localhost:5006> in your browser.

## How it works

- **Characters** — total length of the text, including spaces and newlines
  (multibyte-aware via `mb_strlen`).
- **Words** — runs of non-whitespace separated by whitespace.
- **Lines** — number of newline-separated rows (handles `\n`, `\r\n`, and `\r`).

All output is HTML-escaped, so pasted text is displayed safely.

## Files

- `index.php` — the entire application (form, logic, and view).
- `composer.json` — dependency/requirement manifest.
- `README.md` — this file.
