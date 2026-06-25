<?php

declare(strict_types=1);

function send_security_headers(): void
{
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
    header("Content-Security-Policy: default-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function start_secure_session(): void
{
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'domain' => '',
        'secure' => session_cookie_secure(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);

    session_name('secure_subscriptions_session');
    session_start();
}

function csrf_token(): string
{
    if (!isset($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }

    return $_SESSION['csrf_token'];
}

function verify_csrf_token(?string $token): void
{
    if (!is_string($token) || !hash_equals(csrf_token(), $token)) {
        http_response_code(419);
        render_error_page('Your session expired. Refresh the page and try again.');
    }
}

function normalize_email(mixed $email): ?string
{
    if (!is_string($email)) {
        return null;
    }

    $email = trim($email);
    if ($email === '' || strlen($email) > 254) {
        return null;
    }

    $email = filter_var($email, FILTER_SANITIZE_EMAIL);
    if (!is_string($email) || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        return null;
    }

    return strtolower($email);
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function redirect(string $path): never
{
    header('Location: ' . $path, true, 303);
    exit;
}

function is_admin_authenticated(): bool
{
    return ($_SESSION['admin_id'] ?? null) === 'admin';
}

function authenticate_admin(string $username, string $password): bool
{
    if (!hash_equals('admin', $username)) {
        return false;
    }

    $hash = admin_password_hash_from_database('admin');
    if ($hash === null) {
        return false;
    }

    $pepperedPassword = hash_hmac('sha256', $password, app_secret());
    return password_verify($pepperedPassword, $hash);
}
