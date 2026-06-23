<?php

use App\Auth;

/** HTML-escape a value for safe output. */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

/** Issue a redirect and stop execution. */
function redirect(string $path): void
{
    header('Location: ' . $path);
    exit;
}

/** Return (and lazily create) the per-session CSRF token. */
function csrf_token(): string
{
    Auth::start();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

/** Hidden input carrying the CSRF token, for use inside forms. */
function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . e(csrf_token()) . '">';
}

/** Validate a submitted CSRF token; abort with 400 on mismatch. */
function csrf_verify(): void
{
    Auth::start();
    $token = $_POST['csrf'] ?? '';
    if (!is_string($token) || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $token)) {
        http_response_code(400);
        exit('Invalid CSRF token. Please go back and try again.');
    }
}

/** Render a view file wrapped in the shared layout. */
function view(string $name, array $data = []): void
{
    extract($data, EXTR_SKIP);
    $currentUser = Auth::user();

    ob_start();
    require dirname(__DIR__) . '/views/' . $name . '.php';
    $content = ob_get_clean();

    require dirname(__DIR__) . '/views/layout.php';
}

/** Human-friendly timestamp. */
function fmt_date(?string $sqlDate): string
{
    if (!$sqlDate) {
        return '';
    }
    return date('M j, Y \a\t g:i a', strtotime($sqlDate));
}
