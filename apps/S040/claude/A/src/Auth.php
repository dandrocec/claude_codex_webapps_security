<?php

declare(strict_types=1);

namespace App;

/**
 * Session-based authentication: registration, login, logout and "who am I".
 */
final class Auth
{
    /** Return the currently logged-in user row, or null for guests. */
    public static function user(): ?array
    {
        if (empty($_SESSION['user_id'])) {
            return null;
        }

        $stmt = Database::conn()->prepare('SELECT * FROM users WHERE id = :id');
        $stmt->execute(['id' => $_SESSION['user_id']]);
        $user = $stmt->fetch();

        return $user ?: null;
    }

    public static function check(): bool
    {
        return !empty($_SESSION['user_id']);
    }

    /** Redirect guests to the login page. */
    public static function requireLogin(): void
    {
        if (!self::check()) {
            flash('Please log in to continue.', 'error');
            redirect('/login');
        }
    }

    /**
     * Attempt to register a new account.
     *
     * @return array<int, string> Validation errors (empty on success).
     */
    public static function register(string $username, string $email, string $password): array
    {
        $errors = [];
        $username = trim($username);
        $email = trim($email);

        if (strlen($username) < 3) {
            $errors[] = 'Username must be at least 3 characters.';
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors[] = 'Please enter a valid email address.';
        }
        if (strlen($password) < 6) {
            $errors[] = 'Password must be at least 6 characters.';
        }

        if ($errors) {
            return $errors;
        }

        $pdo = Database::conn();
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = :u OR email = :e');
        $stmt->execute(['u' => $username, 'e' => $email]);
        if ((int) $stmt->fetchColumn() > 0) {
            return ['That username or email is already taken.'];
        }

        $stmt = $pdo->prepare(
            'INSERT INTO users (username, email, password_hash) VALUES (:u, :e, :p)'
        );
        $stmt->execute([
            'u' => $username,
            'e' => $email,
            'p' => password_hash($password, PASSWORD_DEFAULT),
        ]);

        self::startSession((int) $pdo->lastInsertId());

        return [];
    }

    /** Attempt to log in. Returns true on success. */
    public static function login(string $email, string $password): bool
    {
        $stmt = Database::conn()->prepare('SELECT * FROM users WHERE email = :e');
        $stmt->execute(['e' => trim($email)]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            return false;
        }

        self::startSession((int) $user['id']);

        return true;
    }

    public static function logout(): void
    {
        unset($_SESSION['user_id']);
        session_regenerate_id(true);
    }

    private static function startSession(int $userId): void
    {
        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
    }
}
