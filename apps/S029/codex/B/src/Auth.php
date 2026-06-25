<?php

declare(strict_types=1);

namespace Guestbook;

use PDO;

final class Auth
{
    public static function register(PDO $pdo, string $email, string $password): void
    {
        $hash = password_hash($password, PASSWORD_ARGON2ID);
        $stmt = $pdo->prepare('INSERT INTO users (email, password_hash, created_at) VALUES (:email, :password_hash, :created_at)');

        try {
            $stmt->execute([
                ':email' => $email,
                ':password_hash' => $hash,
                ':created_at' => gmdate('c'),
            ]);
        } catch (\PDOException) {
            throw new \RuntimeException('Unable to register that account.');
        }

        self::establishSession((int) $pdo->lastInsertId());
    }

    public static function login(PDO $pdo, string $email, string $password): bool
    {
        $stmt = $pdo->prepare('SELECT id, password_hash FROM users WHERE email = :email LIMIT 1');
        $stmt->execute([':email' => $email]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            password_hash($password, PASSWORD_ARGON2ID);
            return false;
        }

        if (password_needs_rehash($user['password_hash'], PASSWORD_ARGON2ID)) {
            $rehash = $pdo->prepare('UPDATE users SET password_hash = :password_hash WHERE id = :id');
            $rehash->execute([
                ':password_hash' => password_hash($password, PASSWORD_ARGON2ID),
                ':id' => (int) $user['id'],
            ]);
        }

        self::establishSession((int) $user['id']);
        return true;
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_regenerate_id(true);
            session_destroy();
        }
    }

    public static function user(PDO $pdo): ?array
    {
        $id = self::userId();
        if ($id === null) {
            return null;
        }

        $stmt = $pdo->prepare('SELECT id, email FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $id]);
        $user = $stmt->fetch();

        return $user ?: null;
    }

    public static function userId(): ?int
    {
        return isset($_SESSION['user_id']) && is_int($_SESSION['user_id']) ? $_SESSION['user_id'] : null;
    }

    public static function requireUser(): void
    {
        if (self::userId() === null) {
            throw new \RuntimeException('Please sign in first.');
        }
    }

    private static function establishSession(int $userId): void
    {
        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
    }
}
