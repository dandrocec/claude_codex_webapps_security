<?php
declare(strict_types=1);

namespace PhotoBlog;

use PDO;
use RuntimeException;

final class PostRepository
{
    public function __construct(private PDO $pdo)
    {
    }

    public function all(): array
    {
        return $this->pdo->query(
            'SELECT posts.id, posts.image_name, posts.caption, posts.created_at, users.username, users.id AS user_id
             FROM posts
             JOIN users ON users.id = posts.user_id
             ORDER BY datetime(posts.created_at) DESC, posts.id DESC'
        )->fetchAll();
    }

    public function create(int $userId, string $imageName, string $caption): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO posts (user_id, image_name, caption) VALUES (:user_id, :image_name, :caption)');
        $stmt->execute(['user_id' => $userId, 'image_name' => $imageName, 'caption' => $caption]);
    }

    public function findOwned(int $postId, int $userId): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM posts WHERE id = :id AND user_id = :user_id');
        $stmt->execute(['id' => $postId, 'user_id' => $userId]);
        $post = $stmt->fetch();
        if (!$post) {
            throw new RuntimeException('Post not found.', 404);
        }
        return $post;
    }

    public function update(int $postId, int $userId, string $caption, ?string $imageName): void
    {
        if ($imageName !== null) {
            $stmt = $this->pdo->prepare('UPDATE posts SET caption = :caption, image_name = :image_name, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id');
            $stmt->execute(['caption' => $caption, 'image_name' => $imageName, 'id' => $postId, 'user_id' => $userId]);
            return;
        }
        $stmt = $this->pdo->prepare('UPDATE posts SET caption = :caption, updated_at = CURRENT_TIMESTAMP WHERE id = :id AND user_id = :user_id');
        $stmt->execute(['caption' => $caption, 'id' => $postId, 'user_id' => $userId]);
    }

    public function delete(int $postId, int $userId): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM posts WHERE id = :id AND user_id = :user_id');
        $stmt->execute(['id' => $postId, 'user_id' => $userId]);
    }
}
