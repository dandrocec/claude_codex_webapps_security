<?php

declare(strict_types=1);

/**
 * Small view/utility helpers shared across the front controller and templates.
 */

/** Escape a value for safe HTML output. */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

/** Generate (once per session) and return the CSRF token. */
function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf_token'];
}

/** Hidden input carrying the CSRF token, for embedding in forms. */
function csrf_field(): string
{
    return '<input type="hidden" name="csrf_token" value="' . e(csrf_token()) . '">';
}

/** Validate a submitted CSRF token; aborts the request on mismatch. */
function csrf_verify(): void
{
    $token = $_POST['csrf_token'] ?? '';
    if (!is_string($token) || !hash_equals($_SESSION['csrf_token'] ?? '', $token)) {
        http_response_code(419);
        exit('Invalid or expired form token. Please go back and try again.');
    }
}

/** Redirect helper. */
function redirect(string $to): never
{
    header('Location: ' . $to);
    exit;
}

/** Stash a one-time flash message in the session. */
function flash(string $message): void
{
    $_SESSION['flash'][] = $message;
}

/** Pull and clear any pending flash messages. */
function take_flashes(): array
{
    $messages = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);

    return $messages;
}
