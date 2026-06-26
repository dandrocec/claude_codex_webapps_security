# Secure PHP Discussion Forum

A small PHP forum with registration, login, boards, newest-first threads, replies, reply counts, and moderator post deletion.

## Run Locally

Requires PHP 8.1+ with PDO SQLite enabled.

```bash
composer install
APP_SECRET="change-this-long-random-secret" APP_ENV=local php -S 127.0.0.1:5058 -t public
```

Open http://127.0.0.1:5058.

The app stores SQLite data in `storage/forum.sqlite` by default. Override with:

```bash
DATABASE_PATH="/absolute/path/forum.sqlite"
```

The first registered user becomes a moderator. All later users are regular members.
