<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Data access for contacts. Every query is scoped by user_id so a user can
 * only ever read or mutate their own rows (prevents IDOR).
 */
final class ContactRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function forUser(int $userId, string $search = ''): array
    {
        $search = trim($search);

        if ($search !== '') {
            $stmt = $this->pdo->prepare(
                'SELECT id, name, email, phone, address
                 FROM contacts
                 WHERE user_id = :uid AND name LIKE :search ESCAPE \'\\\'
                 ORDER BY LOWER(name) ASC'
            );
            $stmt->bindValue(':uid', $userId, PDO::PARAM_INT);
            $stmt->bindValue(':search', '%' . $this->escapeLike($search) . '%');
        } else {
            $stmt = $this->pdo->prepare(
                'SELECT id, name, email, phone, address
                 FROM contacts
                 WHERE user_id = :uid
                 ORDER BY LOWER(name) ASC'
            );
            $stmt->bindValue(':uid', $userId, PDO::PARAM_INT);
        }

        $stmt->execute();

        return $stmt->fetchAll();
    }

    /** @return array<string, mixed>|null */
    public function find(int $id, int $userId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, name, email, phone, address
             FROM contacts
             WHERE id = :id AND user_id = :uid'
        );
        $stmt->bindValue(':id', $id, PDO::PARAM_INT);
        $stmt->bindValue(':uid', $userId, PDO::PARAM_INT);
        $stmt->execute();
        $row = $stmt->fetch();

        return $row !== false ? $row : null;
    }

    /** @param array<string, string> $data */
    public function create(int $userId, array $data): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO contacts (user_id, name, email, phone, address)
             VALUES (:uid, :name, :email, :phone, :address)'
        );
        $stmt->execute([
            ':uid' => $userId,
            ':name' => $data['name'],
            ':email' => $data['email'] ?? '',
            ':phone' => $data['phone'] ?? '',
            ':address' => $data['address'] ?? '',
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    /**
     * @param array<string, string> $data
     * @return bool True when a row owned by the user was updated.
     */
    public function update(int $id, int $userId, array $data): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE contacts
             SET name = :name, email = :email, phone = :phone, address = :address,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = :id AND user_id = :uid'
        );
        $stmt->execute([
            ':name' => $data['name'],
            ':email' => $data['email'] ?? '',
            ':phone' => $data['phone'] ?? '',
            ':address' => $data['address'] ?? '',
            ':id' => $id,
            ':uid' => $userId,
        ]);

        return $stmt->rowCount() > 0;
    }

    public function delete(int $id, int $userId): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM contacts WHERE id = :id AND user_id = :uid');
        $stmt->bindValue(':id', $id, PDO::PARAM_INT);
        $stmt->bindValue(':uid', $userId, PDO::PARAM_INT);
        $stmt->execute();

        return $stmt->rowCount() > 0;
    }

    /**
     * Escape LIKE wildcards so user input is treated literally within the
     * pattern (the SQL itself stays parameterised).
     */
    private function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
