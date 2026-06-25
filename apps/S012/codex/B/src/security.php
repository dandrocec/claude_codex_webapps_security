<?php
declare(strict_types=1);

function configure_security(): void
{
    error_reporting(E_ALL);
    ini_set('display_errors', getenv('APP_DEBUG') === 'true' ? '1' : '0');
    ini_set('log_errors', '1');

    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header("Permissions-Policy: geolocation=(), microphone=(), camera=()");
    header("Content-Security-Policy: default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; style-src 'self'");

    $secureCookie = is_https() || getenv('APP_COOKIE_SECURE') === 'true';
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $secureCookie,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_name('secure_contact_session');
    session_start();
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function clean_text(mixed $value, int $maxLength): string
{
    $text = is_string($value) ? $value : '';
    $text = str_replace("\0", '', $text);
    $text = trim(preg_replace('/[^\P{C}\r\n\t]+/u', '', $text) ?? '');

    if (mb_strlen($text, 'UTF-8') > $maxLength) {
        $text = mb_substr($text, 0, $maxLength, 'UTF-8');
    }

    return $text;
}

function clean_email(mixed $value): ?string
{
    $email = clean_text($value, 254);
    $email = filter_var($email, FILTER_VALIDATE_EMAIL);

    return is_string($email) ? $email : null;
}

function app_secret(): string
{
    $secret = getenv('APP_SECRET');
    if (is_string($secret) && strlen($secret) >= 32) {
        return $secret;
    }

    return session_id();
}

function csrf_token(): string
{
    if (!isset($_SESSION['csrf_seed'])) {
        $_SESSION['csrf_seed'] = bin2hex(random_bytes(32));
    }

    return hash_hmac('sha256', $_SESSION['csrf_seed'], app_secret());
}

function csrf_verify(mixed $token): bool
{
    return is_string($token) && hash_equals(csrf_token(), $token);
}

function admin_verify_password(string $password): bool
{
    $hash = getenv('ADMIN_PASSWORD_HASH');
    if (!is_string($hash) || $hash === '') {
        error_log('ADMIN_PASSWORD_HASH is not configured.');
        return false;
    }

    $info = password_get_info($hash);
    if (!in_array($info['algoName'], ['bcrypt', 'argon2i', 'argon2id'], true)) {
        error_log('ADMIN_PASSWORD_HASH must use bcrypt or Argon2.');
        return false;
    }

    return password_verify($password, $hash);
}

function require_admin(): void
{
    if (($_SESSION['admin_id'] ?? null) !== 'local-admin') {
        header('Location: /login.php', true, 303);
        exit;
    }
}
