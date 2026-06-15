<?php
declare(strict_types=1);

namespace App;

/**
 * Quote data-access. Every query uses bound parameters (no string-built SQL).
 */
final class Quote
{
    public const MAX_TEXT   = 1000;
    public const MAX_AUTHOR = 120;

    /** Approved quotes for the public page, optionally filtered by author. */
    public static function approved(?string $author = null): array
    {
        $pdo = Database::connection();
        if ($author !== null && $author !== '') {
            $stmt = $pdo->prepare(
                'SELECT q.id, q.text, q.author, q.created_at, u.username AS submitter
                 FROM quotes q JOIN users u ON u.id = q.user_id
                 WHERE q.approved = 1 AND q.author = :author
                 ORDER BY q.created_at DESC'
            );
            $stmt->execute([':author' => $author]);
        } else {
            $stmt = $pdo->query(
                'SELECT q.id, q.text, q.author, q.created_at, u.username AS submitter
                 FROM quotes q JOIN users u ON u.id = q.user_id
                 WHERE q.approved = 1
                 ORDER BY q.created_at DESC'
            );
        }
        return $stmt->fetchAll();
    }

    /** Distinct authors that have at least one approved quote (for the filter). */
    public static function approvedAuthors(): array
    {
        $stmt = Database::connection()->query(
            'SELECT DISTINCT author FROM quotes WHERE approved = 1 ORDER BY author COLLATE NOCASE ASC'
        );
        return array_map(static fn ($r) => (string) $r['author'], $stmt->fetchAll());
    }

    /** Quotes belonging to a given user (any approval state). */
    public static function forUser(int $userId): array
    {
        $stmt = Database::connection()->prepare(
            'SELECT id, text, author, approved, created_at FROM quotes
             WHERE user_id = :uid ORDER BY created_at DESC'
        );
        $stmt->execute([':uid' => $userId]);
        return $stmt->fetchAll();
    }

    /** Pending (unapproved) quotes for the admin review queue. */
    public static function pending(): array
    {
        $stmt = Database::connection()->query(
            'SELECT q.id, q.text, q.author, q.created_at, u.username AS submitter
             FROM quotes q JOIN users u ON u.id = q.user_id
             WHERE q.approved = 0 ORDER BY q.created_at ASC'
        );
        return $stmt->fetchAll();
    }

    public static function setApproved(int $id, bool $approved): bool
    {
        $stmt = Database::connection()->prepare(
            'UPDATE quotes SET approved = :a, updated_at = :ts WHERE id = :id'
        );
        $stmt->execute([
            ':a'  => $approved ? 1 : 0,
            ':ts' => gmdate('Y-m-d H:i:s'),
            ':id' => $id,
        ]);
        return $stmt->rowCount() > 0;
    }

    public static function delete(int $id): bool
    {
        $stmt = Database::connection()->prepare('DELETE FROM quotes WHERE id = :id');
        $stmt->execute([':id' => $id]);
        return $stmt->rowCount() > 0;
    }

    public static function find(int $id): ?array
    {
        $stmt = Database::connection()->prepare('SELECT * FROM quotes WHERE id = :id');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public static function create(int $userId, string $text, string $author): int
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO quotes (user_id, text, author, approved, created_at, updated_at)
             VALUES (:uid, :text, :author, 0, :ts, :ts)'
        );
        $stmt->execute([
            ':uid'    => $userId,
            ':text'   => $text,
            ':author' => $author,
            ':ts'     => gmdate('Y-m-d H:i:s'),
        ]);
        return (int) $pdo->lastInsertId();
    }

    /** Update is scoped to the owning user to prevent IDOR. */
    public static function updateOwned(int $id, int $userId, string $text, string $author): bool
    {
        $stmt = Database::connection()->prepare(
            'UPDATE quotes SET text = :text, author = :author, approved = 0, updated_at = :ts
             WHERE id = :id AND user_id = :uid'
        );
        $stmt->execute([
            ':text'   => $text,
            ':author' => $author,
            ':ts'     => gmdate('Y-m-d H:i:s'),
            ':id'     => $id,
            ':uid'    => $userId,
        ]);
        return $stmt->rowCount() > 0;
    }

    /**
     * Validate and normalise quote input.
     *
     * @return array{0:array{text:string,author:string},1:array<string,string>}
     */
    public static function validate(array $input): array
    {
        $text   = trim((string) ($input['text'] ?? ''));
        $author = trim((string) ($input['author'] ?? ''));
        $errors = [];

        // Normalise whitespace; reject control characters.
        $text   = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text) ?? '';
        $author = preg_replace('/[\x00-\x1F\x7F]/u', '', $author) ?? '';
        $author = trim(preg_replace('/\s+/u', ' ', $author) ?? '');

        if ($text === '') {
            $errors['text'] = 'Quote text is required.';
        } elseif (mb_strlen($text) > self::MAX_TEXT) {
            $errors['text'] = 'Quote text must be at most ' . self::MAX_TEXT . ' characters.';
        }

        if ($author === '') {
            $errors['author'] = 'Author is required.';
        } elseif (mb_strlen($author) > self::MAX_AUTHOR) {
            $errors['author'] = 'Author must be at most ' . self::MAX_AUTHOR . ' characters.';
        }

        return [['text' => $text, 'author' => $author], $errors];
    }
}
