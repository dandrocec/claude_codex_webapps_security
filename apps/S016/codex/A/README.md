# Simple Poll

A small PHP app with one poll question, three answer options, file-backed vote storage, and a live tally.

## Run locally

Requirements:

- PHP 8.1 or newer
- Composer is optional; there are no third-party dependencies

Start the app on port 5016:

```bash
php -S localhost:5016 index.php
```

Or, if you prefer Composer scripts:

```bash
composer start
```

Then open:

```text
http://localhost:5016
```

Votes are stored in `data/votes.json`, which is created automatically after the first vote.
