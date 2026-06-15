<?php
/**
 * Shared HTML helpers: a tiny page wrapper and an output-escaping helper.
 */

declare(strict_types=1);

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function render_header(string $title): void
{
    ?><!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= e($title) ?></title>
    <style>
        :root { color-scheme: light dark; }
        body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            max-width: 640px;
            margin: 3rem auto;
            padding: 0 1.25rem;
            line-height: 1.5;
        }
        h1 { margin-bottom: 0.25rem; }
        nav { margin-bottom: 2rem; }
        nav a { margin-right: 1rem; }
        form { display: flex; gap: 0.5rem; margin: 1.5rem 0; flex-wrap: wrap; }
        input[type="email"] {
            flex: 1 1 240px;
            padding: 0.6rem 0.75rem;
            font-size: 1rem;
            border: 1px solid #8888;
            border-radius: 6px;
        }
        button {
            padding: 0.6rem 1.1rem;
            font-size: 1rem;
            border: 0;
            border-radius: 6px;
            background: #2563eb;
            color: #fff;
            cursor: pointer;
        }
        button:hover { background: #1d4ed8; }
        .flash { padding: 0.75rem 1rem; border-radius: 6px; margin: 1rem 0; }
        .flash.success { background: #dcfce7; color: #166534; }
        .flash.error   { background: #fee2e2; color: #991b1b; }
        table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
        th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid #8884; }
        .muted { color: #6b7280; font-size: 0.9rem; }
    </style>
</head>
<body>
    <nav>
        <a href="/">Subscribe</a>
        <a href="/subscribers.php">Subscribers</a>
    </nav>
<?php
}

function render_footer(): void
{
    ?>
</body>
</html>
<?php
}
