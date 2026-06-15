<?php

declare(strict_types=1);

/**
 * Context-aware HTML output encoding to prevent XSS.
 * Use for any value placed into HTML text or attribute context.
 */
function e(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/* -------------------------------------------------------------------------
 * CSRF protection
 * ---------------------------------------------------------------------- */

/** Return the per-session CSRF token, generating one if needed. */
function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

/** Render a hidden CSRF input for embedding in forms. */
function csrf_field(): string
{
    return '<input type="hidden" name="csrf_token" value="' . e(csrf_token()) . '">';
}

/** Constant-time validation of a submitted CSRF token. */
function csrf_validate(mixed $submitted): bool
{
    return is_string($submitted)
        && !empty($_SESSION['csrf_token'])
        && hash_equals($_SESSION['csrf_token'], $submitted);
}

/* -------------------------------------------------------------------------
 * Flash messages (one-shot, survive a redirect)
 * ---------------------------------------------------------------------- */

function flash_set(string $key, string $value): void
{
    $_SESSION['_flash'][$key] = $value;
}

function flash_get(string $key): ?string
{
    $value = $_SESSION['_flash'][$key] ?? null;
    unset($_SESSION['_flash'][$key]);
    return $value;
}

/* -------------------------------------------------------------------------
 * Views
 * ---------------------------------------------------------------------- */

/** Render a template to a string with the given data in scope. */
function view(string $template, array $data = []): string
{
    extract($data, EXTR_SKIP);
    ob_start();
    require dirname(__DIR__) . "/templates/$template.php";
    return (string) ob_get_clean();
}

/** Render a page template wrapped in the site layout and echo it. */
function render(string $template, array $data = []): void
{
    $content = view($template, $data);
    echo view('layout', [
        'title'   => $data['title'] ?? 'Newsletter',
        'content' => $content,
        'isAdmin' => !empty($_SESSION['admin']),
    ]);
}

/* -------------------------------------------------------------------------
 * Misc
 * ---------------------------------------------------------------------- */

/** Issue a redirect and stop. */
function redirect(string $path): never
{
    header('Location: ' . $path);
    http_response_code(303);
    exit;
}

/** True when an admin is authenticated for the current session. */
function is_admin(): bool
{
    return !empty($_SESSION['admin']);
}

/** Require an authenticated admin or redirect to the login page. */
function require_admin(): void
{
    if (!is_admin()) {
        flash_set('error', 'Please sign in to view that page.');
        redirect('/admin/login');
    }
}
