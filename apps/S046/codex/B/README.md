# Secure PHP Quotes

A small PHP 8.2 quotes app using SQLite via PDO. Users can register, log in, submit quotes, and edit their own submissions. Public visitors can browse approved quotes and filter by author. Admin users can approve or reject submissions.

## Run locally on port 5046

```bash
composer install
APP_ENV=local APP_SECRET="replace-with-a-long-random-value" SESSION_SECURE_COOKIE=false composer start
```

Open `http://127.0.0.1:5046`.

By default the app stores SQLite data in `storage/app.sqlite`. You can override this with:

```bash
DATABASE_PATH=/absolute/path/to/app.sqlite
```

To create an admin account, set `ADMIN_EMAIL` before registering that email:

```bash
ADMIN_EMAIL=admin@example.com APP_ENV=local APP_SECRET="replace-with-a-long-random-value" SESSION_SECURE_COOKIE=false composer start
```

## Security notes

- Uses parameterised PDO queries.
- Stores passwords with PHP `password_hash()` using bcrypt.
- Validates input and escapes HTML output.
- Requires CSRF tokens on all state-changing requests.
- Enforces quote ownership before editing user submissions.
- Sets security headers and secure session options.
- Reads secrets and deployment-sensitive settings from environment variables.
