<?php

declare(strict_types=1);

final class Auth
{
    public function __construct(private PDO $pdo)
    {
    }

    public function user(): ?array
    {
        if (empty($_SESSION['user_id'])) {
            return null;
        }

        $stmt = $this->pdo->prepare('SELECT id, name, email, role FROM users WHERE id = ?');
        $stmt->execute([(int) $_SESSION['user_id']]);
        $user = $stmt->fetch();

        return $user ?: null;
    }

    public function login(string $email, string $password): bool
    {
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE email = ?');
        $stmt->execute([trim(strtolower($email))]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password_hash'])) {
            return false;
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int) $user['id'];

        return true;
    }

    public function register(string $name, string $email, string $password, string $role): array
    {
        $name = trim($name);
        $email = trim(strtolower($email));
        $role = $role === 'vendor' ? 'vendor' : 'buyer';

        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 6) {
            return [false, 'Use a name, a valid email, and a password with at least 6 characters.'];
        }

        try {
            $stmt = $this->pdo->prepare(
                'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
            );
            $stmt->execute([$name, $email, password_hash($password, PASSWORD_DEFAULT), $role]);
            $_SESSION['user_id'] = (int) $this->pdo->lastInsertId();

            return [true, ''];
        } catch (PDOException) {
            return [false, 'That email is already registered.'];
        }
    }

    public function logout(): void
    {
        $_SESSION = [];
        session_destroy();
    }
}
