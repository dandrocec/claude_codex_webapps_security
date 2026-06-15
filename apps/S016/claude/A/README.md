# PHP Poll

A minimal single-question poll. Visitors pick one of three options and submit;
votes are persisted to a JSON file (`data/votes.json`) and the current tally is
shown for every option.

## Requirements

- PHP 7.4 or newer (no extensions beyond the standard library)

PHP ships with everything needed, so `composer install` is **not** required —
`composer.json` is included only to document the dependency and provide a
`start` script.

## Run it locally on port 5016

Using PHP's built-in web server:

```bash
php -S 0.0.0.0:5016
```

Or via Composer:

```bash
composer start
```

Then open http://localhost:5016 in your browser.

## How it works

- `index.php` — the whole app: renders the form, handles the vote `POST`, and
  draws the result bars.
- `data/votes.json` — created automatically on the first vote; holds the counts.

Votes are written atomically (temp file + rename with an exclusive lock) so a
reader never sees a half-written file. After a vote the app issues a
Post/Redirect/Get redirect, so refreshing the results page will not record a
duplicate vote.

To reset the poll, delete `data/votes.json`.
