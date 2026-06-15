<?php

declare(strict_types=1);

namespace App;

/**
 * Authentication state and password handling.
 *
 * Passwords are hashed with PASSWORD_DEFAULT, which selects a strong, salted
 * algorithm (bcrypt today, Argon2 where available) and embeds a per-password
 * salt automatically.
 */
final class Auth
{
    public static function hashPassword(string $plain): string
    {
        return password_hash($plain, PASSWORD_DEFAULT);
    }

    public static function verifyPassword(string $plain, string $hash): bool
    {
        return password_verify($plain, $hash);
    }

    public static function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, PASSWORD_DEFAULT);
    }

    /**
     * Records a successful login. Regenerates the session id to prevent
     * session fixation.
     */
    public static function login(int $userId, string $email): void
    {
        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
        $_SESSION['user_email'] = $email;
        $_SESSION['__created'] = time();
    }

    /**
     * Logs the user out. Regenerating the id with delete_old_session=true
     * invalidates the authenticated session server-side, while leaving a fresh,
     * empty session available (e.g. to carry a "signed out" flash message).
     */
    public static function logout(): void
    {
        session_regenerate_id(true);
        $_SESSION = [];
        $_SESSION['__created'] = time();
    }

    public static function check(): bool
    {
        return isset($_SESSION['user_id']) && is_int($_SESSION['user_id']);
    }

    public static function id(): ?int
    {
        return self::check() ? (int) $_SESSION['user_id'] : null;
    }

    public static function email(): ?string
    {
        $email = $_SESSION['user_email'] ?? null;

        return is_string($email) ? $email : null;
    }
}
