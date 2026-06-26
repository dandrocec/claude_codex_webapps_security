<?php

declare(strict_types=1);

namespace Marketplace;

final class Auth
{
    public function __construct(private readonly Repository $repository)
    {
    }

    public function user(): ?array
    {
        $id = $_SESSION['user_id'] ?? null;
        if (!is_int($id)) {
            return null;
        }

        return $this->repository->findUserById($id);
    }

    public function id(): ?int
    {
        $user = $this->user();
        return $user ? (int) $user['id'] : null;
    }

    public function login(string $email, string $password): bool
    {
        $user = $this->repository->findUserByEmail($email);
        if (!$user || !password_verify($password, (string) $user['password_hash'])) {
            return false;
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];
        unset($_SESSION['csrf_nonce']);
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
                'secure' => true,
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
        }
        session_destroy();
    }

    public function requireLogin(): array
    {
        $user = $this->user();
        if (!$user) {
            Http::redirect('/login');
        }

        return $user;
    }

    public function requireRole(string $role): array
    {
        $user = $this->requireLogin();
        if ($user['role'] !== $role) {
            http_response_code(403);
            exit('Forbidden');
        }

        return $user;
    }
}
