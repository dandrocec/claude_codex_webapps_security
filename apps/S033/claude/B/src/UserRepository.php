<?php

declare(strict_types=1);

namespace App;

use PDO;

final class UserRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /** @return array<string, mixed>|null */
    public function findByEmail(string $email): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, email, password_hash FROM users WHERE email = :email');
        $stmt->execute([':email' => mb_strtolower($email)]);
        $row = $stmt->fetch();

        return $row !== false ? $row : null;
    }

    public function emailExists(string $email): bool
    {
        $stmt = $this->pdo->prepare('SELECT 1 FROM users WHERE email = :email');
        $stmt->execute([':email' => mb_strtolower($email)]);

        return $stmt->fetchColumn() !== false;
    }

    public function create(string $email, string $passwordHash): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO users (email, password_hash) VALUES (:email, :hash)'
        );
        $stmt->execute([
            ':email' => mb_strtolower($email),
            ':hash' => $passwordHash,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    public function updatePasswordHash(int $userId, string $passwordHash): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET password_hash = :hash WHERE id = :id');
        $stmt->execute([':hash' => $passwordHash, ':id' => $userId]);
    }
}
