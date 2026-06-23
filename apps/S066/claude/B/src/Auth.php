<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Authentication & registration. Passwords are hashed with a strong, salted
 * algorithm (Argon2id when available, otherwise bcrypt) plus an APP_KEY pepper.
 */
final class Auth
{
    private static function algo(): string
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    }

    /**
     * HMAC-pepper the password before hashing so a DB leak alone is not enough
     * to start cracking. The pepper lives only in the environment (APP_KEY).
     */
    private static function pepper(string $password): string
    {
        return hash_hmac('sha256', $password, Config::appKey());
    }

    public static function hashPassword(string $password): string
    {
        $hash = password_hash(self::pepper($password), self::algo());
        if ($hash === false) {
            throw new \RuntimeException('Password hashing failed.');
        }
        return $hash;
    }

    /**
     * @return array{0:bool,1:?string} [success, error-message]
     */
    public static function register(string $name, string $email, string $password): array
    {
        $pdo = Database::pdo();

        $stmt = $pdo->prepare('SELECT 1 FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $email]);
        if ($stmt->fetchColumn() !== false) {
            return [false, 'An account with that email already exists.'];
        }

        $stmt = $pdo->prepare(
            'INSERT INTO users (name, email, password_hash, role)
             VALUES (:name, :email, :hash, :role)'
        );
        $stmt->execute([
            ':name'  => $name,
            ':email' => $email,
            ':hash'  => self::hashPassword($password),
            ':role'  => 'agent',
        ]);

        return [true, null];
    }

    public static function attempt(string $email, string $password): bool
    {
        $pdo = Database::pdo();
        $stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $email]);
        $user = $stmt->fetch();

        if ($user === false) {
            // Dummy verify to keep timing comparable and avoid user enumeration.
            password_verify('dummy', '$2y$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
            return false;
        }

        if (!password_verify(self::pepper($password), (string) $user['password_hash'])) {
            return false;
        }

        // Opportunistically upgrade the hash if parameters changed.
        if (password_needs_rehash((string) $user['password_hash'], self::algo())) {
            $new = self::hashPassword($password);
            $upd = $pdo->prepare('UPDATE users SET password_hash = :h WHERE id = :id');
            $upd->execute([':h' => $new, ':id' => $user['id']]);
        }

        Session::regenerate();
        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['user_name'] = (string) $user['name'];
        $_SESSION['user_role'] = (string) $user['role'];

        return true;
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
                    'samesite' => 'Lax',
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

    public static function name(): ?string
    {
        return $_SESSION['user_name'] ?? null;
    }

    /**
     * Require an authenticated agent or redirect to login.
     */
    public static function requireAgent(): void
    {
        if (!self::check()) {
            redirect('/login');
        }
    }
}
