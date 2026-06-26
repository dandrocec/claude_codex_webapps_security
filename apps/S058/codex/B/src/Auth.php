<?php

declare(strict_types=1);

namespace Forum;

use PDO;

final class Auth
{
    public function __construct(private PDO $db)
    {
    }

    public function user(): ?array
    {
        $id = $_SESSION['user_id'] ?? null;
        if (!is_int($id)) {
            return null;
        }
        $stmt = $this->db->prepare('SELECT id, username, role FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $user = $stmt->fetch();
        return $user ?: null;
    }

    public function requireUser(): array
    {
        $user = $this->user();
        if (!$user) {
            Security::redirect('/login');
        }
        return $user;
    }

    public function isModerator(?array $user = null): bool
    {
        $user ??= $this->user();
        return ($user['role'] ?? '') === 'moderator';
    }

    public function register(string $username, string $password): bool
    {
        $role = ((int) $this->db->query('SELECT COUNT(*) FROM users')->fetchColumn()) === 0 ? 'moderator' : 'user';
        $hash = password_hash($password, PASSWORD_ARGON2ID);
        $stmt = $this->db->prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
        try {
            $stmt->execute([$username, $hash, $role]);
        } catch (\PDOException) {
            return false;
        }
        $this->login($username, $password);
        return true;
    }

    public function login(string $username, string $password): bool
    {
        $stmt = $this->db->prepare('SELECT id, password_hash FROM users WHERE username = ?');
        $stmt->execute([$username]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            return false;
        }
        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
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
}
