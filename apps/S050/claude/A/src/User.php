<?php

declare(strict_types=1);

namespace App;

final class User
{
    /** @return array<string, mixed>|null */
    public static function findByUsername(string $username): ?array
    {
        $stmt = Database::connection()->prepare(
            'SELECT * FROM users WHERE username = ?'
        );
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        return $user ?: null;
    }

    /**
     * Create a user. Returns the new id, or null if the username is taken.
     */
    public static function create(string $username, string $password): ?int
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO users (username, password_hash) VALUES (?, ?)'
        );

        try {
            $stmt->execute([
                $username,
                password_hash($password, PASSWORD_DEFAULT),
            ]);
        } catch (\PDOException $e) {
            // UNIQUE constraint violation -> username already exists.
            if (str_contains($e->getMessage(), 'UNIQUE')) {
                return null;
            }
            throw $e;
        }

        return (int) $pdo->lastInsertId();
    }
}
