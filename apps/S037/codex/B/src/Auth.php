<?php

declare(strict_types=1);

namespace Gallery;

use PDO;
use PDOException;

final class Auth
{
    public function __construct(private PDO $pdo)
    {
    }

    public function register(string $username, string $password): void
    {
        $hash = password_hash($password, PASSWORD_ARGON2ID);
        if ($hash === false) {
            throw new ValidationException('Could not create account.');
        }

        try {
            $stmt = $this->pdo->prepare('INSERT INTO users (username, password_hash, created_at) VALUES (:username, :password_hash, :created_at)');
            $stmt->execute([
                'username' => $username,
                'password_hash' => $hash,
                'created_at' => gmdate('c'),
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                throw new ValidationException('That username is already taken.');
            }
            throw $e;
        }
    }

    public function login(string $username, string $password): bool
    {
        $stmt = $this->pdo->prepare('SELECT id, username, password_hash FROM users WHERE username = :username');
        $stmt->execute(['username' => $username]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            return false;
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$user['id'];
        $_SESSION['username'] = $user['username'];
        return true;
    }

    public function logout(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
    }

    public function requireLogin(): void
    {
        if ($this->userId() === null) {
            Http::redirect('/login');
        }
    }

    public function userId(): ?int
    {
        return isset($_SESSION['user_id']) ? (int)$_SESSION['user_id'] : null;
    }

    public function user(): ?array
    {
        if (!$this->userId()) {
            return null;
        }

        return [
            'id' => $this->userId(),
            'username' => (string)($_SESSION['username'] ?? 'user'),
        ];
    }
}
