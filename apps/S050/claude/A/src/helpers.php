<?php

declare(strict_types=1);

/**
 * Small procedural helpers used across controllers and templates.
 */

/** Escape a string for safe HTML output. */
function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8');
}

/** Send a redirect to a path within the app and stop. */
function redirect(string $path): never
{
    header('Location: ' . $path);
    exit;
}

/** Get (and rotate) the CSRF token for the current session. */
function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/** Abort with 400 unless the submitted token matches the session token. */
function verify_csrf(): void
{
    $sent = $_POST['csrf_token'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf_token'] ?? '', $sent)) {
        http_response_code(400);
        exit('Invalid CSRF token. Please go back and try again.');
    }
}

/** Stash a one-shot flash message shown on the next rendered page. */
function flash(string $message): void
{
    $_SESSION['flash'] = $message;
}

/** Pull and clear the pending flash message, if any. */
function take_flash(): ?string
{
    $message = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    return $message;
}

/** The currently logged-in user row, or null. */
function current_user(): ?array
{
    return $_SESSION['user'] ?? null;
}

/** Require a logged-in user; redirect to login otherwise. */
function require_login(): array
{
    $user = current_user();
    if ($user === null) {
        flash('Please log in to continue.');
        redirect('/login');
    }
    return $user;
}

/**
 * Render a template inside the shared layout and exit.
 *
 * @param array<string, mixed> $data
 */
function view(string $template, array $data = []): never
{
    extract($data, EXTR_SKIP);
    $templateFile = dirname(__DIR__) . '/templates/' . $template . '.php';

    ob_start();
    require $templateFile;
    $content = ob_get_clean();

    require dirname(__DIR__) . '/templates/layout.php';
    exit;
}
