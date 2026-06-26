# PHP Discussion Forum

A small PHP and SQLite discussion forum with registration, login, boards, threads, replies, newest-first thread ordering, reply counts, and moderator post deletion.

## Run Locally

Requirements:

- PHP 8.1 or newer
- PDO SQLite extension enabled

Start the app on port 5058:

```bash
php -S 127.0.0.1:5058 index.php
```

Then open:

```text
http://127.0.0.1:5058
```

The SQLite database is created automatically at `data/forum.sqlite`.

The first registered user is automatically made a moderator. Later users are regular members.
