<?php
declare(strict_types=1);

/**
 * Authentication helpers. Passwords are hashed with PASSWORD_DEFAULT
 * (bcrypt today; PHP upgrades the algorithm automatically over time).
 */

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    static $cache = null;
    if ($cache !== null && $cache['id'] === $_SESSION['user_id']) {
        return $cache;
    }
    $stmt = db()->prepare('SELECT id, email, display_name FROM users WHERE id = ?');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    $cache = $user ?: null;
    return $cache;
}

function is_logged_in(): bool
{
    return current_user() !== null;
}

/** Require an authenticated user, otherwise redirect to login. */
function require_login(): array
{
    $user = current_user();
    if ($user === null) {
        flash('Please log in to continue.', 'error');
        redirect('/login');
    }
    return $user;
}

function login_user(int $userId): void
{
    // Prevent session fixation: new id on privilege change.
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
}

function logout_user(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 42000,
            'path'     => $p['path'],
            'domain'   => $p['domain'],
            'secure'   => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'],
        ]);
    }
    session_destroy();
}

/** The algorithm used for hashing: Argon2id when available, else bcrypt. */
function password_algo(): string
{
    return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
}

function password_hash_strong(string $plain): string
{
    // Both Argon2id and bcrypt are strong, salted, adaptive hashes.
    return password_hash($plain, password_algo());
}

/** True if the stored hash should be upgraded to the current algorithm/cost. */
function password_needs_rehash_strong(string $hash): bool
{
    return password_needs_rehash($hash, password_algo());
}
