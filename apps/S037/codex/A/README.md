# PHP Image Gallery

A small PHP image gallery where logged-in users can upload images with captions. The public gallery shows thumbnails that link to a full image view with the caption.

## Run Locally

Requirements:

- PHP 8.1 or newer
- PDO SQLite extension
- GD extension recommended for generated thumbnails

Start the app on port 5037:

```bash
php -S localhost:5037 -t public
```

Then open:

```text
http://localhost:5037
```

The app creates `data/gallery.sqlite` and `public/uploads/` automatically on first request.
