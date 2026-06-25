<?php

declare(strict_types=1);

function render_header(string $title): void
{
    ?>
    <!doctype html>
    <html lang="en">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title><?= e($title) ?></title>
        <link rel="stylesheet" href="/assets/styles.css">
    </head>
    <body>
    <?php
}

function render_footer(): void
{
    ?>
    </body>
    </html>
    <?php
}

function render_error_page(string $message): never
{
    render_header('Error');
    ?>
    <main class="page">
        <section class="panel">
            <h1>Request failed</h1>
            <div class="notice error" role="alert"><?= e($message) ?></div>
            <p class="admin-link"><a href="/index.php">Return home</a></p>
        </section>
    </main>
    <?php
    render_footer();
    exit;
}

function format_timestamp(string $timestamp): string
{
    try {
        return (new DateTimeImmutable($timestamp))->format('Y-m-d H:i:s');
    } catch (Throwable) {
        return $timestamp;
    }
}
