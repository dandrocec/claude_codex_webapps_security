<?php

declare(strict_types=1);

namespace App;

/**
 * Session-based authentication helpers.
 */
final class Auth
{
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
    }

    public static function attempt(string $username, string $password): bool
    {
        $stmt = Database::connection()->prepare(
            'SELECT * FROM users WHERE username = :login OR email = :login_email'
        );
        $stmt->execute([':login' => $username, ':login_email' => $username]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            return false;
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['username'] = $user['username'];
        $_SESSION['is_admin'] = (bool) $user['is_admin'];

        return true;
    }

    public static function register(string $username, string $email, string $password): array
    {
        $errors = [];

        $username = trim($username);
        $email = trim($email);

        if (strlen($username) < 3) {
            $errors[] = 'Username must be at least 3 characters.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = 'A valid email address is required.';
        }
        if (strlen($password) < 6) {
            $errors[] = 'Password must be at least 6 characters.';
        }

        if ($errors) {
            return $errors;
        }

        $pdo = Database::connection();
        $exists = $pdo->prepare('SELECT 1 FROM users WHERE username = :u OR email = :e');
        $exists->execute([':u' => $username, ':e' => $email]);
        if ($exists->fetchColumn()) {
            return ['That username or email is already taken.'];
        }

        $stmt = $pdo->prepare(
            'INSERT INTO users (username, email, password_hash) VALUES (:u, :e, :p)'
        );
        $stmt->execute([
            ':u' => $username,
            ':e' => $email,
            ':p' => password_hash($password, PASSWORD_DEFAULT),
        ]);

        return [];
    }

    public static function logout(): void
    {
        $_SESSION = [];
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

    public static function requireLogin(): void
    {
        if (!self::check()) {
            header('Location: ?page=login');
            exit;
        }
    }
}
