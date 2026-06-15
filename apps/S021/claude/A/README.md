# Base64 Encoder / Decoder

A tiny single-file PHP web app. Enter text, pick a direction (**encode** or
**decode**), submit, and see the Base64 result.

## Requirements

- PHP 8.0 or newer (uses the built-in web server — no extra extensions needed)
- [Composer](https://getcomposer.org/) is optional (only used for the `start` script)

## Run locally on port 5021

Using PHP's built-in server directly:

```bash
php -S localhost:5021
```

Or via Composer:

```bash
composer start
```

Then open <http://localhost:5021> in your browser.

## How it works

- **Encode** runs the input through `base64_encode()`.
- **Decode** runs it through `base64_decode(..., true)` in strict mode, so
  invalid Base64 input produces a friendly error instead of garbage.
- All output is HTML-escaped before rendering to prevent XSS.

## Files

| File            | Purpose                                  |
| --------------- | ---------------------------------------- |
| `index.php`     | The form, the conversion logic, and view |
| `composer.json` | Dependency manifest + `start` script     |
| `README.md`     | This file                                |
