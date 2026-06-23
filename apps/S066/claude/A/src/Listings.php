<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Data access for listings, their photos, and contact messages.
 */
final class Listings
{
    /**
     * Search/filter listings.
     *
     * @param array{q?:string,location?:string,min_price?:?int,max_price?:?int,type?:string} $filters
     * @return array<int,array<string,mixed>>
     */
    public static function search(array $filters = []): array
    {
        $pdo = Database::pdo();

        $where = ["l.status = 'active'"];
        $params = [];

        if (!empty($filters['q'])) {
            $where[] = '(l.title LIKE ? OR l.description LIKE ? OR l.location LIKE ?)';
            $like = '%' . $filters['q'] . '%';
            array_push($params, $like, $like, $like);
        }
        if (!empty($filters['location'])) {
            $where[] = 'l.location LIKE ?';
            $params[] = '%' . $filters['location'] . '%';
        }
        if (isset($filters['min_price']) && $filters['min_price'] !== null) {
            $where[] = 'l.price >= ?';
            $params[] = $filters['min_price'];
        }
        if (isset($filters['max_price']) && $filters['max_price'] !== null) {
            $where[] = 'l.price <= ?';
            $params[] = $filters['max_price'];
        }
        if (!empty($filters['type'])) {
            $where[] = 'l.property_type = ?';
            $params[] = $filters['type'];
        }

        $sql = 'SELECT l.*, a.name AS agent_name,
                       (SELECT filename FROM photos p WHERE p.listing_id = l.id ORDER BY p.id LIMIT 1) AS cover
                FROM listings l
                JOIN agents a ON a.id = l.agent_id
                WHERE ' . implode(' AND ', $where) . '
                ORDER BY l.created_at DESC';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** All listings owned by an agent (any status). */
    public static function forAgent(int $agentId): array
    {
        $stmt = Database::pdo()->prepare(
            "SELECT l.*,
                    (SELECT filename FROM photos p WHERE p.listing_id = l.id ORDER BY p.id LIMIT 1) AS cover
             FROM listings l WHERE l.agent_id = ? ORDER BY l.created_at DESC"
        );
        $stmt->execute([$agentId]);
        return $stmt->fetchAll();
    }

    public static function find(int $id): ?array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT l.*, a.name AS agent_name, a.email AS agent_email, a.phone AS agent_phone
             FROM listings l JOIN agents a ON a.id = l.agent_id WHERE l.id = ?'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** @return array<int,array<string,mixed>> */
    public static function photos(int $listingId): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT * FROM photos WHERE listing_id = ? ORDER BY id'
        );
        $stmt->execute([$listingId]);
        return $stmt->fetchAll();
    }

    public static function create(int $agentId, array $data): int
    {
        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'INSERT INTO listings
                (agent_id, title, description, price, location, address,
                 bedrooms, bathrooms, area_sqft, property_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $agentId,
            $data['title'],
            $data['description'],
            $data['price'],
            $data['location'],
            $data['address'],
            $data['bedrooms'],
            $data['bathrooms'],
            $data['area_sqft'],
            $data['property_type'],
        ]);
        return (int) $pdo->lastInsertId();
    }

    public static function update(int $id, int $agentId, array $data): bool
    {
        $stmt = Database::pdo()->prepare(
            'UPDATE listings SET title = ?, description = ?, price = ?, location = ?,
                    address = ?, bedrooms = ?, bathrooms = ?, area_sqft = ?, property_type = ?
             WHERE id = ? AND agent_id = ?'
        );
        return $stmt->execute([
            $data['title'],
            $data['description'],
            $data['price'],
            $data['location'],
            $data['address'],
            $data['bedrooms'],
            $data['bathrooms'],
            $data['area_sqft'],
            $data['property_type'],
            $id,
            $agentId,
        ]);
    }

    /** Delete a listing (and its photos/messages via cascade) if owned by the agent. */
    public static function delete(int $id, int $agentId): bool
    {
        // Remove photo files from disk first.
        foreach (self::photos($id) as $photo) {
            $path = dirname(__DIR__) . '/public/uploads/' . $photo['filename'];
            if (is_file($path)) {
                @unlink($path);
            }
        }
        $stmt = Database::pdo()->prepare('DELETE FROM listings WHERE id = ? AND agent_id = ?');
        return $stmt->execute([$id, $agentId]);
    }

    public static function addPhoto(int $listingId, string $filename): void
    {
        $stmt = Database::pdo()->prepare(
            'INSERT INTO photos (listing_id, filename) VALUES (?, ?)'
        );
        $stmt->execute([$listingId, $filename]);
    }

    public static function addMessage(int $listingId, int $agentId, array $data): void
    {
        $stmt = Database::pdo()->prepare(
            'INSERT INTO messages (listing_id, agent_id, sender_name, sender_email, sender_phone, body)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $listingId,
            $agentId,
            $data['sender_name'],
            $data['sender_email'],
            $data['sender_phone'],
            $data['body'],
        ]);
    }

    /** Messages received for an agent's listings. */
    public static function messagesForAgent(int $agentId): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT m.*, l.title AS listing_title
             FROM messages m JOIN listings l ON l.id = m.listing_id
             WHERE m.agent_id = ? ORDER BY m.created_at DESC'
        );
        $stmt->execute([$agentId]);
        return $stmt->fetchAll();
    }
}
