# Secure PHP Contact Form

Small PHP contact form that accepts a name, email address, and message. Submissions are appended to `storage/submissions.jsonl`; an SQLite file is also maintained with prepared statements for indexed reads.

## Run locally on port 5012

Requires PHP 8.1+ with PDO SQLite enabled.

```powershell
$env:APP_SECRET="replace-with-a-long-random-secret"
$env:ADMIN_PASSWORD_HASH=(php -r "echo password_hash('change-this-admin-password', PASSWORD_ARGON2ID);")
php -S 127.0.0.1:5012 -t public
```

Open:

- Contact form: `http://127.0.0.1:5012/`
- Admin login: `http://127.0.0.1:5012/login.php`
- Submissions: `http://127.0.0.1:5012/submissions.php`

For local HTTP, secure cookies are automatically relaxed so sessions work. In production behind HTTPS, set `APP_COOKIE_SECURE=true`.

## Environment variables

- `APP_SECRET`: long random value used to bind CSRF tokens.
- `ADMIN_PASSWORD_HASH`: bcrypt or Argon2id password hash for the submissions admin.
- `APP_COOKIE_SECURE`: set to `true` to force Secure session cookies.
- `APP_DEBUG`: leave unset in normal use; internal errors are not shown to clients.
