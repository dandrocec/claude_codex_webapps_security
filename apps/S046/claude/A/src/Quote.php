<?php

declare(strict_types=1);

namespace App;

/**
 * Data access for quotes.
 */
final class Quote
{
    /**
     * Approved quotes for the public page, optionally filtered by author.
     */
    public static function approved(?string $author = null): array
    {
        $sql = 'SELECT q.*, u.username
                FROM quotes q
                JOIN users u ON u.id = q.user_id
                WHERE q.approved = 1';
        $params = [];

        if ($author !== null && $author !== '') {
            $sql .= ' AND q.author = :author';
            $params[':author'] = $author;
        }

        $sql .= ' ORDER BY q.created_at DESC';

        $stmt = Database::connection()->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll();
    }

    /**
     * Distinct list of authors that have at least one approved quote.
     */
    public static function authors(): array
    {
        $rows = Database::connection()
            ->query('SELECT DISTINCT author FROM quotes WHERE approved = 1 ORDER BY author COLLATE NOCASE')
            ->fetchAll();

        return array_column($rows, 'author');
    }

    public static function forUser(int $userId): array
    {
        $stmt = Database::connection()->prepare(
            'SELECT * FROM quotes WHERE user_id = :uid ORDER BY created_at DESC'
        );
        $stmt->execute([':uid' => $userId]);

        return $stmt->fetchAll();
    }

    public static function find(int $id): ?array
    {
        $stmt = Database::connection()->prepare('SELECT * FROM quotes WHERE id = :id');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();

        return $row ?: null;
    }

    public static function create(int $userId, string $text, string $author): void
    {
        $stmt = Database::connection()->prepare(
            'INSERT INTO quotes (user_id, text, author) VALUES (:uid, :text, :author)'
        );
        $stmt->execute([
            ':uid' => $userId,
            ':text' => trim($text),
            ':author' => trim($author),
        ]);
    }

    /**
     * Update a quote. Editing resets approval so changes are re-reviewed.
     */
    public static function update(int $id, string $text, string $author): void
    {
        $stmt = Database::connection()->prepare(
            "UPDATE quotes
             SET text = :text, author = :author, approved = 0, updated_at = datetime('now')
             WHERE id = :id"
        );
        $stmt->execute([
            ':text' => trim($text),
            ':author' => trim($author),
            ':id' => $id,
        ]);
    }

    public static function approve(int $id): void
    {
        Database::connection()
            ->prepare('UPDATE quotes SET approved = 1 WHERE id = :id')
            ->execute([':id' => $id]);
    }

    public static function pending(): array
    {
        return Database::connection()
            ->query('SELECT q.*, u.username
                     FROM quotes q
                     JOIN users u ON u.id = q.user_id
                     WHERE q.approved = 0
                     ORDER BY q.created_at ASC')
            ->fetchAll();
    }
}
