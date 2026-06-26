# Secure PHP Real Estate

A small PHP/PDO real-estate site where agents create property listings with photos, visitors search by price and location, and inquiries are sent through a protected contact form.

## Run locally on port 5066

```bash
export APP_SECRET="replace-with-a-long-random-secret"
export DATABASE_PATH="storage/app.sqlite"
export SESSION_SECURE="false"
composer run serve
```

On Windows PowerShell:

```powershell
$env:APP_SECRET="replace-with-a-long-random-secret"
$env:DATABASE_PATH="storage/app.sqlite"
$env:SESSION_SECURE="false"
composer run serve
```

Open `http://127.0.0.1:5066`. The SQLite database and upload directory are created automatically under `storage/`.

For production, use HTTPS, set `SESSION_SECURE=true`, provide a strong `APP_SECRET` from the environment, and serve only the `public/` directory.
