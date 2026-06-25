# Email Subscription App

A small PHP app for collecting email subscriptions and viewing the stored subscriber list.

## Requirements

- PHP 8.1 or newer

## Run Locally

From the project directory, start PHP's built-in server on port 5025:

```bash
php -S localhost:5025
```

Then open:

```text
http://localhost:5025
```

The subscriber list is available at:

```text
http://localhost:5025/subscribers.php
```

Submitted addresses are stored in `storage/subscribers.json`, which is created automatically when needed.
