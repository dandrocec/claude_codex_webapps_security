# Secure Email Subscriptions

A small PHP app with an email subscription form, confirmation page, and an authenticated admin list of subscribed addresses.

## Run locally on port 5025

```bash
export APP_SECRET="replace-with-a-long-random-secret"
export ADMIN_PASSWORD="replace-with-a-strong-password"
export SESSION_COOKIE_SECURE="0"
php -S 127.0.0.1:5025 -t public
```

On Windows PowerShell:

```powershell
$env:APP_SECRET="replace-with-a-long-random-secret"
$env:ADMIN_PASSWORD="replace-with-a-strong-password"
$env:SESSION_COOKIE_SECURE="0"
php -S 127.0.0.1:5025 -t public
```

Open `http://127.0.0.1:5025`.

The subscription form is public. The subscriber list is available at `/admin.php`; sign in with username `admin` and the password from `ADMIN_PASSWORD`.

## Notes

- SQLite data is stored in `storage/app.sqlite`.
- Secrets are read from environment variables.
- The app uses CSRF tokens, parameterised queries, secure session settings, security headers, validated input, escaped output, and Argon2id password hashing. Set `SESSION_COOKIE_SECURE=1` behind HTTPS.
