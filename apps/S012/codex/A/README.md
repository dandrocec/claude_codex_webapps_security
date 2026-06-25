# PHP Contact Form

A small PHP application with a contact form, a thank-you page, and a submissions list backed by a local JSON Lines file.

## Run Locally

From this directory, start the PHP built-in server on port 5012:

```bash
php -S 127.0.0.1:5012 -t public
```

Or, if Composer is installed:

```bash
composer start
```

Then open:

```text
http://127.0.0.1:5012
```

Submissions are stored in `storage/submissions.jsonl`. The app creates that file automatically when the first form submission is received.
