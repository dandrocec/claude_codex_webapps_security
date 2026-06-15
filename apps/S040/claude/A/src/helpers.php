<?php

declare(strict_types=1);

/**
 * Small collection of procedural helpers used across the app: output escaping,
 * CSRF protection, flash messages, and a minimal template renderer.
 */

/** Escape a value for safe HTML output. */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Send a redirect and stop execution. */
function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

/** Format a price for display. */
function money(float $amount): string
{
    return '$' . number_format($amount, 2);
}

/* ----------------------------------------------------------------------------
 * CSRF protection
 * ------------------------------------------------------------------------- */

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . e(csrf_token()) . '">';
}

/** Abort the request unless a valid CSRF token was submitted. */
function csrf_verify(): void
{
    $submitted = $_POST['csrf'] ?? '';
    if (!is_string($submitted) || !hash_equals($_SESSION['csrf'] ?? '', $submitted)) {
        http_response_code(419);
        exit('Invalid or missing CSRF token. Please go back and try again.');
    }
}

/* ----------------------------------------------------------------------------
 * Flash messages (one-shot notifications surviving a redirect)
 * ------------------------------------------------------------------------- */

function flash(string $message, string $type = 'success'): void
{
    $_SESSION['flash'][] = ['message' => $message, 'type' => $type];
}

/** @return array<int, array{message: string, type: string}> */
function take_flash(): array
{
    $messages = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return $messages;
}

/* ----------------------------------------------------------------------------
 * Views
 * ------------------------------------------------------------------------- */

/** Render a template into a string. */
function view(string $template, array $data = []): string
{
    extract($data, EXTR_SKIP);
    ob_start();
    include dirname(__DIR__) . '/templates/' . $template . '.php';
    return (string) ob_get_clean();
}

/** Render a template wrapped in the site layout and echo the result. */
function render(string $template, array $data = [], string $title = 'PHP Classifieds'): void
{
    $content = view($template, $data);
    echo view('layout', ['content' => $content, 'title' => $title]);
}
