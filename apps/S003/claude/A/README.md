# Tip Calculator (PHP)

A single-page web app: enter a bill amount, tip percentage, and number of
people, then submit to see the tip amount, the total, and what each person owes.

## Requirements

- PHP 8.0 or newer (no external libraries needed). Check with `php --version`.

`composer.json` is included as the dependency manifest, but the app has no
package dependencies beyond PHP itself, so `composer install` is optional.

## Run locally on port 5003

From this directory, start PHP's built-in web server:

```bash
php -S localhost:5003
```

Or, if you use Composer:

```bash
composer start
```

Then open <http://localhost:5003> in your browser.

## Files

- `index.php` — the form, the calculation logic, and the results section.
- `composer.json` — dependency manifest.
- `README.md` — this file.
