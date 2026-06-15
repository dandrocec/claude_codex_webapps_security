# PHP Image Gallery

A small image gallery in plain PHP:

- **Logged-in users** upload images with a caption.
- A **public gallery page** shows thumbnails, each linking to the full image and its caption.
- Image **metadata is stored in a database** (SQLite — no separate DB server to install).
- Thumbnails are generated on upload with the GD extension.

## Requirements

- **PHP 8.0+** with the `pdo_sqlite`, `gd`, and `fileinfo` extensions
  (all bundled with standard PHP builds).
- That's it — there are no third-party Composer packages. The `composer.json`
  is the dependency manifest; it only declares the PHP version and required
  extensions.

Check your PHP has what's needed:

```bash
php -v
php -m | grep -E "pdo_sqlite|gd|fileinfo"
```

## Run it locally on port 5037

From the project root, start PHP's built-in web server with `public/` as the
document root:

```bash
php -S localhost:5037 -t public
```

Or, if you have Composer installed, the same command is wired up as a script:

```bash
composer start
```

Then open **http://localhost:5037**.

The database, default user, and upload folders are created automatically on the
first request — no migration or seeding step is needed.

## Default login

| Username | Password   |
| -------- | ---------- |
| `admin`  | `admin123` |

Log in, click **Upload**, choose a JPEG/PNG/GIF/WebP image, add a caption, and
it appears on the public gallery immediately.

## Project layout

```
composer.json          Dependency manifest (PHP + extensions)
public/                Web document root (-t public)
  index.php            Public gallery (thumbnail grid)
  image.php            Full image + caption view
  login.php            Login form
  logout.php           Logout (POST)
  upload.php           Upload form (login required)
  assets/style.css     Styles
  uploads/             Uploaded images + thumbs/ (created at runtime)
src/
  bootstrap.php        Session, paths, DB connection + schema, helpers
  images.php           Upload validation + GD thumbnail generation
  layout.php           Shared page header/footer
data/                  SQLite database file (created at runtime)
```

## Notes on data & security

- Metadata lives in `data/gallery.sqlite` (tables `users` and `images`).
  Original files and thumbnails live under `public/uploads/`.
- `data/` and `src/` sit **outside** the document root, so the database and
  application code are never served over HTTP.
- Passwords are hashed with `password_hash()`; forms are CSRF-protected;
  uploads are validated by real MIME type, size-limited (8 MB), and stored
  under randomized filenames.
- This is a learning/demo app using PHP's built-in dev server. For production,
  put it behind Apache/nginx + PHP-FPM and change the default password.

### Add another user

```bash
php -r 'require "src/bootstrap.php"; $s=db()->prepare("INSERT INTO users (username,password_hash) VALUES (?,?)"); $s->execute(["alice", password_hash("secret", PASSWORD_DEFAULT)]); echo "created\n";'
```

### Reset everything

Stop the server and delete `data/gallery.sqlite` and the contents of
`public/uploads/` (keep `uploads/.htaccess`). The next request recreates them.
