# PHP Real Estate Site

A dependency-free PHP real-estate application using SQLite. Agents can register, sign in, create listings with uploaded photos, edit or delete their own listings, and view contact messages. Visitors can search listings by location and filter by price, then contact the listing agent through a form.

## Run Locally

Requirements:

- PHP 8.1 or newer
- PHP SQLite extensions: `pdo` and `pdo_sqlite`

Start the app on port 5066:

```bash
php -S 127.0.0.1:5066 -t public
```

Then open:

```text
http://127.0.0.1:5066
```

The app creates its SQLite database automatically at `data/app.sqlite` and stores uploaded listing photos in `public/uploads`.
