# PHP Quotes App

A small PHP 8.1 application where users can register, log in, submit quotes, edit their own submissions, and browse approved quotes by author.

## Run locally on port 5046

```bash
composer install
composer serve
```

Then open:

```text
http://127.0.0.1:5046
```

The app uses SQLite. On first load it creates `database/app.sqlite` automatically and seeds an admin account:

```text
Email: admin@example.com
Password: admin123
```

Admin users can approve, unapprove, edit, and delete quotes from the dashboard.
