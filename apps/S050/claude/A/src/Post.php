<?php

declare(strict_types=1);

namespace App;

final class Post
{
    /**
     * Public feed: every post, newest first, joined with its author.
     *
     * @return list<array<string, mixed>>
     */
    public static function feed(): array
    {
        $stmt = Database::connection()->query(
            'SELECT posts.*, users.username
               FROM posts
               JOIN users ON users.id = posts.user_id
           ORDER BY posts.created_at DESC, posts.id DESC'
        );

        return $stmt->fetchAll();
    }

    /** @return array<string, mixed>|null */
    public static function find(int $id): ?array
    {
        $stmt = Database::connection()->prepare(
            'SELECT posts.*, users.username
               FROM posts
               JOIN users ON users.id = posts.user_id
              WHERE posts.id = ?'
        );
        $stmt->execute([$id]);
        $post = $stmt->fetch();

        return $post ?: null;
    }

    public static function create(int $userId, string $imagePath, string $caption): int
    {
        $pdo = Database::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO posts (user_id, image_path, caption) VALUES (?, ?, ?)'
        );
        $stmt->execute([$userId, $imagePath, $caption]);

        return (int) $pdo->lastInsertId();
    }

    public static function update(int $id, string $caption, ?string $imagePath = null): void
    {
        if ($imagePath !== null) {
            $stmt = Database::connection()->prepare(
                'UPDATE posts SET caption = ?, image_path = ? WHERE id = ?'
            );
            $stmt->execute([$caption, $imagePath, $id]);
            return;
        }

        $stmt = Database::connection()->prepare(
            'UPDATE posts SET caption = ? WHERE id = ?'
        );
        $stmt->execute([$caption, $id]);
    }

    public static function delete(int $id): void
    {
        $stmt = Database::connection()->prepare('DELETE FROM posts WHERE id = ?');
        $stmt->execute([$id]);
    }
}
