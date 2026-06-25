<?php
declare(strict_types=1);

namespace PhotoBlog;

use PDO;
use RuntimeException;

final class Auth
{
    public function __construct(private PDO $pdo)
    {
    }

    public function register(string $username, string $password): void
    {
        if (!preg_match('/^[A-Za-z0-9_.-]{3,40}$/', $username)) {
            throw new RuntimeException('Use 3-40 letters, numbers, dots, hyphens, or underscores for usernames.', 422);
        }
        $hash = password_hash($password, PASSWORD_ARGON2ID);
        $stmt = $this->pdo->prepare('INSERT INTO users (username, password_hash) VALUES (:username, :password_hash)');
        try {
            $stmt->execute(['username' => $username, 'password_hash' => $hash]);
        } catch (\PDOException) {
            throw new RuntimeException('That username is already taken.', 422);
        }
        $this->login($username, $password);
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
        return true;
    }

    public function logout(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires' => time() - 42000,
                'path' => $params['path'],
                'domain' => $params['domain'],
                'secure' => $params['secure'],
                'httponly' => $params['httponly'],
                'samesite' => $params['samesite'] ?? 'Lax',
            ]);
        }
        session_destroy();
    }

    public function user(): ?array
    {
        if (empty($_SESSION['user_id'])) {
            return null;
        }
        $stmt = $this->pdo->prepare('SELECT id, username FROM users WHERE id = :id');
        $stmt->execute(['id' => (int)$_SESSION['user_id']]);
        $user = $stmt->fetch();
        return $user ?: null;
    }

    public function requireUser(): array
    {
        $user = $this->user();
        if (!$user) {
            throw new RuntimeException('Please log in first.', 401);
        }
        return $user;
    }
}
