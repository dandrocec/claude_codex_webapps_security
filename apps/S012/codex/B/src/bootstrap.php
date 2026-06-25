<?php
declare(strict_types=1);

require __DIR__ . '/security.php';
require __DIR__ . '/SubmissionRepository.php';

const STORAGE_DIR = __DIR__ . '/../storage';

configure_security();

function submissions(): SubmissionRepository
{
    static $repo = null;
    if ($repo === null) {
        $repo = new SubmissionRepository(
            STORAGE_DIR . '/submissions.jsonl',
            STORAGE_DIR . '/submissions.sqlite'
        );
    }

    return $repo;
}

function render_header(string $title): void
{
    $safeTitle = e($title);
    echo <<<HTML
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{$safeTitle}</title>
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
HTML;
}

function render_footer(): void
{
    echo '</body></html>';
}

function render_error(string $message): never
{
    render_header('Error');
    echo '<main class="shell"><section class="panel"><h1>Something went wrong</h1><p>' . e($message) . '</p><p><a href="/">Return home</a></p></section></main>';
    render_footer();
    exit;
}
