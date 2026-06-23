<?php

declare(strict_types=1);

namespace App;

/**
 * Listing data access. Every statement is parameterised.
 */
final class Listings
{
    /**
     * Search/filter listings. Filters are applied with bound parameters only.
     *
     * @param array{q?:string,location?:string,min_price?:?int,max_price?:?int,beds?:?int} $f
     * @return array<int,array<string,mixed>>
     */
    public static function search(array $f): array
    {
        $pdo = Database::pdo();
        $where = [];
        $params = [];

        if (!empty($f['q'])) {
            $where[] = "(l.title LIKE :q ESCAPE '\\' OR l.description LIKE :q ESCAPE '\\' OR l.location LIKE :q ESCAPE '\\')";
            $params[':q'] = '%' . self::escapeLike((string) $f['q']) . '%';
        }
        if (!empty($f['location'])) {
            $where[] = "l.location LIKE :loc ESCAPE '\\'";
            $params[':loc'] = '%' . self::escapeLike((string) $f['location']) . '%';
        }
        if (isset($f['min_price']) && $f['min_price'] !== null) {
            $where[] = 'l.price >= :minp';
            $params[':minp'] = (int) $f['min_price'];
        }
        if (isset($f['max_price']) && $f['max_price'] !== null) {
            $where[] = 'l.price <= :maxp';
            $params[':maxp'] = (int) $f['max_price'];
        }
        if (isset($f['beds']) && $f['beds'] !== null) {
            $where[] = 'l.bedrooms >= :beds';
            $params[':beds'] = (int) $f['beds'];
        }

        $sql = 'SELECT l.*, u.name AS agent_name,
                       (SELECT p.id FROM photos p WHERE p.listing_id = l.id ORDER BY p.id LIMIT 1) AS cover_photo_id
                FROM listings l
                JOIN users u ON u.id = l.agent_id';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= ' ORDER BY l.created_at DESC, l.id DESC LIMIT 200';

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public static function find(int $id): ?array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT l.*, u.name AS agent_name, u.email AS agent_email
             FROM listings l JOIN users u ON u.id = l.agent_id
             WHERE l.id = :id'
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** @return array<int,array<string,mixed>> */
    public static function forAgent(int $agentId): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT l.*,
                    (SELECT COUNT(*) FROM photos p WHERE p.listing_id = l.id) AS photo_count,
                    (SELECT p.id FROM photos p WHERE p.listing_id = l.id ORDER BY p.id LIMIT 1) AS cover_photo_id
             FROM listings l WHERE l.agent_id = :aid
             ORDER BY l.created_at DESC, l.id DESC'
        );
        $stmt->execute([':aid' => $agentId]);
        return $stmt->fetchAll();
    }

    /** @return array<int,array<string,mixed>> */
    public static function photos(int $listingId): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT * FROM photos WHERE listing_id = :lid ORDER BY id'
        );
        $stmt->execute([':lid' => $listingId]);
        return $stmt->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public static function findPhoto(int $photoId): ?array
    {
        $stmt = Database::pdo()->prepare('SELECT * FROM photos WHERE id = :id');
        $stmt->execute([':id' => $photoId]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string,mixed> $data */
    public static function create(int $agentId, array $data): int
    {
        $pdo = Database::pdo();
        $stmt = $pdo->prepare(
            'INSERT INTO listings (agent_id, title, description, price, location, bedrooms, bathrooms, area_sqm)
             VALUES (:aid, :title, :desc, :price, :loc, :beds, :baths, :area)'
        );
        $stmt->execute([
            ':aid'   => $agentId,
            ':title' => $data['title'],
            ':desc'  => $data['description'],
            ':price' => $data['price'],
            ':loc'   => $data['location'],
            ':beds'  => $data['bedrooms'],
            ':baths' => $data['bathrooms'],
            ':area'  => $data['area_sqm'],
        ]);
        return (int) $pdo->lastInsertId();
    }

    /** @param array<string,mixed> $data */
    public static function update(int $listingId, array $data): void
    {
        $stmt = Database::pdo()->prepare(
            'UPDATE listings
             SET title=:title, description=:desc, price=:price, location=:loc,
                 bedrooms=:beds, bathrooms=:baths, area_sqm=:area,
                 updated_at=datetime(\'now\')
             WHERE id=:id'
        );
        $stmt->execute([
            ':title' => $data['title'],
            ':desc'  => $data['description'],
            ':price' => $data['price'],
            ':loc'   => $data['location'],
            ':beds'  => $data['bedrooms'],
            ':baths' => $data['bathrooms'],
            ':area'  => $data['area_sqm'],
            ':id'    => $listingId,
        ]);
    }

    public static function delete(int $listingId): void
    {
        $stmt = Database::pdo()->prepare('DELETE FROM listings WHERE id = :id');
        $stmt->execute([':id' => $listingId]);
    }

    public static function addPhoto(int $listingId, string $filename, string $mime): void
    {
        $stmt = Database::pdo()->prepare(
            'INSERT INTO photos (listing_id, filename, mime) VALUES (:lid, :fn, :mime)'
        );
        $stmt->execute([':lid' => $listingId, ':fn' => $filename, ':mime' => $mime]);
    }

    public static function deletePhoto(int $photoId): void
    {
        $stmt = Database::pdo()->prepare('DELETE FROM photos WHERE id = :id');
        $stmt->execute([':id' => $photoId]);
    }

    public static function addInquiry(int $listingId, int $agentId, string $name, string $email, string $body): void
    {
        $stmt = Database::pdo()->prepare(
            'INSERT INTO inquiries (listing_id, agent_id, sender_name, sender_email, body)
             VALUES (:lid, :aid, :name, :email, :body)'
        );
        $stmt->execute([
            ':lid'   => $listingId,
            ':aid'   => $agentId,
            ':name'  => $name,
            ':email' => $email,
            ':body'  => $body,
        ]);
    }

    /** @return array<int,array<string,mixed>> */
    public static function inquiriesForAgent(int $agentId): array
    {
        $stmt = Database::pdo()->prepare(
            'SELECT i.*, l.title AS listing_title
             FROM inquiries i JOIN listings l ON l.id = i.listing_id
             WHERE i.agent_id = :aid ORDER BY i.created_at DESC, i.id DESC LIMIT 100'
        );
        $stmt->execute([':aid' => $agentId]);
        return $stmt->fetchAll();
    }

    private static function escapeLike(string $value): string
    {
        // Escape LIKE wildcards; callers pair this with no ESCAPE clause needs
        // because we only wrap with %...%. Backslash-escape % and _.
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
