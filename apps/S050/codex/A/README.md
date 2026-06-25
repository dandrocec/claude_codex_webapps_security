# PHP Photo Blog

A small PHP photo blog where registered users can publish image posts with captions. The public feed is newest-first, and authors can edit or delete their own posts.

## Run locally

Requirements:

- PHP 8.1 or newer
- SQLite PDO extension enabled
- Fileinfo extension enabled

Start the app on port 5050:

```bash
php -S 127.0.0.1:5050 -t public
```

Or, if you use Composer:

```bash
composer run serve
```

Open:

```text
http://127.0.0.1:5050
```

The app creates `data/blog.sqlite` and `public/uploads/` automatically on first use.
