<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Data access for classified listings.
 */
final class Listing
{
    public const PER_PAGE = 12;

    /** @return array<int, array> All categories ordered by name. */
    public static function categories(): array
    {
        return Database::conn()
            ->query('SELECT * FROM categories ORDER BY name')
            ->fetchAll();
    }

    public static function category(int $id): ?array
    {
        $stmt = Database::conn()->prepare('SELECT * FROM categories WHERE id = :id');
        $stmt->execute(['id' => $id]);
        return $stmt->fetch() ?: null;
    }

    /**
     * Search/browse listings with optional keyword and category filters.
     *
     * @return array{items: array<int, array>, total: int}
     */
    public static function search(?string $keyword, ?int $categoryId, int $page): array
    {
        $where = [];
        $params = [];

        if ($keyword !== null && $keyword !== '') {
            $where[] = '(l.title LIKE :kw OR l.description LIKE :kw)';
            $params['kw'] = '%' . $keyword . '%';
        }
        if ($categoryId !== null) {
            $where[] = 'l.category_id = :cat';
            $params['cat'] = $categoryId;
        }

        $clause = $where ? 'WHERE ' . implode(' AND ', $where) : '';
        $pdo = Database::conn();

        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM listings l $clause");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        $offset = max(0, ($page - 1) * self::PER_PAGE);
        $sql = "SELECT l.*, c.name AS category_name, u.username AS seller
                FROM listings l
                JOIN categories c ON c.id = l.category_id
                JOIN users u ON u.id = l.user_id
                $clause
                ORDER BY l.created_at DESC
                LIMIT :limit OFFSET :offset";

        $stmt = $pdo->prepare($sql);
        foreach ($params as $key => $value) {
            $stmt->bindValue(':' . $key, $value);
        }
        $stmt->bindValue(':limit', self::PER_PAGE, PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
        $stmt->execute();

        return ['items' => $stmt->fetchAll(), 'total' => $total];
    }

    public static function find(int $id): ?array
    {
        $stmt = Database::conn()->prepare(
            'SELECT l.*, c.name AS category_name, u.username AS seller
             FROM listings l
             JOIN categories c ON c.id = l.category_id
             JOIN users u ON u.id = l.user_id
             WHERE l.id = :id'
        );
        $stmt->execute(['id' => $id]);
        return $stmt->fetch() ?: null;
    }

    /** @return array<int, array> Listings owned by a given user. */
    public static function forUser(int $userId): array
    {
        $stmt = Database::conn()->prepare(
            'SELECT l.*, c.name AS category_name
             FROM listings l
             JOIN categories c ON c.id = l.category_id
             WHERE l.user_id = :uid
             ORDER BY l.created_at DESC'
        );
        $stmt->execute(['uid' => $userId]);
        return $stmt->fetchAll();
    }

    public static function create(int $userId, array $data): int
    {
        $pdo = Database::conn();
        $stmt = $pdo->prepare(
            'INSERT INTO listings (user_id, category_id, title, price, description, photo)
             VALUES (:uid, :cat, :title, :price, :desc, :photo)'
        );
        $stmt->execute([
            'uid' => $userId,
            'cat' => $data['category_id'],
            'title' => $data['title'],
            'price' => $data['price'],
            'desc' => $data['description'],
            'photo' => $data['photo'],
        ]);

        return (int) $pdo->lastInsertId();
    }

    public static function update(int $id, array $data): void
    {
        $stmt = Database::conn()->prepare(
            'UPDATE listings
             SET category_id = :cat, title = :title, price = :price,
                 description = :desc, photo = :photo, updated_at = datetime(\'now\')
             WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'cat' => $data['category_id'],
            'title' => $data['title'],
            'price' => $data['price'],
            'desc' => $data['description'],
            'photo' => $data['photo'],
        ]);
    }

    public static function delete(int $id): void
    {
        $stmt = Database::conn()->prepare('DELETE FROM listings WHERE id = :id');
        $stmt->execute(['id' => $id]);
    }
}
