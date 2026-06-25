# PHP Image Gallery

A small secure image gallery where users can register, log in, upload images with captions, and browse a public thumbnail gallery.

## Run locally on port 5037

1. Install PHP 8.1+ with the `pdo_sqlite`, `fileinfo`, and `gd` extensions enabled.
2. Set an application secret:
   - PowerShell: `$env:APP_SECRET = "replace-with-a-long-random-secret"`
   - macOS/Linux: `export APP_SECRET="replace-with-a-long-random-secret"`
3. For the plain HTTP PHP development server, set local mode:
   - PowerShell: `$env:APP_ENV = "local"`
   - macOS/Linux: `export APP_ENV="local"`
4. Start the app:
   - `composer run serve`
   - or `php -S 127.0.0.1:5037 -t public`
5. Open `http://127.0.0.1:5037`.

The app creates `data/gallery.sqlite` and `storage/uploads` automatically. Optional environment variables are `DB_DSN`, `UPLOAD_DIR`, `MAX_UPLOAD_BYTES`, `APP_ENV`, and `APP_SECURE_COOKIES`.
