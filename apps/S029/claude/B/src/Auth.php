<?php

declare(strict_types=1);

namespace App;

/**
 * Authentication and password handling.
 *
 * Passwords are hashed with Argon2id when available, otherwise bcrypt — both
 * are strong, salted algorithms. The salt is generated and stored by PHP
 * inside the hash string, so we never manage salts manually.
 */
final class Auth
{
    public static function hashPassword(string $plain): string
    {
        // Prefer Argon2id, but only if this PHP build actually supports it;
        // otherwise fall back to bcrypt. Both are strong and salted.
        $supported = function_exists('password_algos') ? password_algos() : [];
        $algo = in_array(PASSWORD_ARGON2ID, $supported, true)
            ? PASSWORD_ARGON2ID
            : PASSWORD_BCRYPT;

        return password_hash($plain, $algo);
    }

    public static function verifyPassword(string $plain, string $hash): bool
    {
        return password_verify($plain, $hash);
    }

    /**
     * Attempt to log a user in. Returns the user row on success, null otherwise.
     * Uses a dummy verify on unknown users to reduce timing side-channels.
     */
    public static function attempt(string $username, string $password): ?array
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare('SELECT * FROM users WHERE username = :u LIMIT 1');
        $stmt->execute([':u' => $username]);
        $user = $stmt->fetch();

        if ($user === false) {
            // Spend roughly the same time as a real verify.
            password_verify($password, '$2y$10$usesomesillystringforsalt000000000000000000000000000000');
            return null;
        }

        if (!self::verifyPassword($password, $user['password_hash'])) {
            return null;
        }

        return $user;
    }

    public static function login(array $user): void
    {
        // Prevent session fixation: issue a fresh session ID on privilege change.
        session_regenerate_id(true);
        $_SESSION['user_id']  = (int) $user['id'];
        $_SESSION['username'] = $user['username'];
        $_SESSION['is_admin'] = (bool) $user['is_admin'];
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                [
                    'expires'  => time() - 42000,
                    'path'     => $params['path'],
                    'domain'   => $params['domain'],
                    'secure'   => $params['secure'],
                    'httponly' => $params['httponly'],
                    'samesite' => $params['samesite'],
                ]
            );
        }
        session_destroy();
    }

    public static function check(): bool
    {
        return isset($_SESSION['user_id']);
    }

    public static function id(): ?int
    {
        return isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null;
    }

    public static function username(): ?string
    {
        return $_SESSION['username'] ?? null;
    }

    public static function isAdmin(): bool
    {
        return !empty($_SESSION['is_admin']);
    }

    /**
     * Create a user. Returns the new id, or null if the username is taken.
     */
    public static function register(string $username, string $password, bool $isAdmin = false): ?int
    {
        $pdo = Database::connection();
        try {
            $stmt = $pdo->prepare(
                'INSERT INTO users (username, password_hash, is_admin) VALUES (:u, :p, :a)'
            );
            $stmt->execute([
                ':u' => $username,
                ':p' => self::hashPassword($password),
                ':a' => $isAdmin ? 1 : 0,
            ]);
            return (int) $pdo->lastInsertId();
        } catch (\PDOException $e) {
            // UNIQUE constraint violation -> username already exists.
            if (str_contains($e->getMessage(), 'UNIQUE')) {
                return null;
            }
            throw $e;
        }
    }
}
