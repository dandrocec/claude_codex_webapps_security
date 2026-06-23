<?php

namespace App;

/**
 * Session-based authentication: register, login, logout and the current user.
 */
class Auth
{
    public static function start(): void
    {
        if (session_status() !== PHP_SESSION_ACTIVE) {
            session_start();
        }
    }

    /** @return array<string,mixed>|null */
    public static function user(): ?array
    {
        self::start();
        if (empty($_SESSION['user_id'])) {
            return null;
        }
        $stmt = Database::pdo()->prepare('SELECT id, username, role, created_at FROM users WHERE id = ?');
        $stmt->execute([$_SESSION['user_id']]);
        $user = $stmt->fetch();
        return $user ?: null;
    }

    public static function check(): bool
    {
        return self::user() !== null;
    }

    public static function isModerator(): bool
    {
        $user = self::user();
        return $user !== null && $user['role'] === 'moderator';
    }

    /**
     * Register a new user.
     *
     * @return array{0:bool,1:string} success flag and an error message on failure
     */
    public static function register(string $username, string $password): array
    {
        $username = trim($username);
        if (strlen($username) < 3 || strlen($username) > 30) {
            return [false, 'Username must be between 3 and 30 characters.'];
        }
        if (!preg_match('/^[A-Za-z0-9_]+$/', $username)) {
            return [false, 'Username may only contain letters, numbers and underscores.'];
        }
        if (strlen($password) < 6) {
            return [false, 'Password must be at least 6 characters.'];
        }

        $pdo = Database::pdo();
        $exists = $pdo->prepare('SELECT 1 FROM users WHERE username = ?');
        $exists->execute([$username]);
        if ($exists->fetchColumn()) {
            return [false, 'That username is already taken.'];
        }

        $stmt = $pdo->prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
        $stmt->execute([$username, password_hash($password, PASSWORD_DEFAULT), 'user']);

        self::start();
        $_SESSION['user_id'] = (int) $pdo->lastInsertId();
        return [true, ''];
    }

    public static function login(string $username, string $password): bool
    {
        $stmt = Database::pdo()->prepare('SELECT id, password_hash FROM users WHERE username = ?');
        $stmt->execute([trim($username)]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            return false;
        }
        self::start();
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        return true;
    }

    public static function logout(): void
    {
        self::start();
        $_SESSION = [];
        session_destroy();
    }
}
