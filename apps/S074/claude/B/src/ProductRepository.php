<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * All product persistence. Every method uses prepared statements and, where a
 * vendor acts on a product, the vendor_id is part of the WHERE clause so a
 * vendor can never read or mutate another vendor's product (prevents IDOR /
 * OWASP A01 - broken access control).
 */
final class ProductRepository
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::connection();
    }

    /** @return array<int,array<string,mixed>> Public catalogue across all vendors. */
    public function allActive(string $search = ''): array
    {
        $sql = 'SELECT p.id, p.name, p.description, p.price_cents, p.stock, u.name AS vendor_name
                FROM products p
                JOIN users u ON u.id = p.vendor_id
                WHERE p.stock > 0';
        $params = [];
        if ($search !== '') {
            $sql .= ' AND (p.name LIKE :q OR p.description LIKE :q)';
            $params[':q'] = '%' . $search . '%';
        }
        $sql .= ' ORDER BY p.created_at DESC, p.id DESC';
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** A single product for the public detail page. */
    public function findPublic(int $id): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT p.id, p.name, p.description, p.price_cents, p.stock, p.vendor_id, u.name AS vendor_name
             FROM products p JOIN users u ON u.id = p.vendor_id
             WHERE p.id = :id'
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** @return array<int,array<string,mixed>> Products owned by one vendor. */
    public function forVendor(int $vendorId): array
    {
        $stmt = $this->db->prepare(
            'SELECT id, name, description, price_cents, stock, created_at
             FROM products WHERE vendor_id = :vid ORDER BY created_at DESC, id DESC'
        );
        $stmt->execute([':vid' => $vendorId]);
        return $stmt->fetchAll();
    }

    /** Fetch a product ONLY if it belongs to the given vendor (ownership check). */
    public function findOwned(int $id, int $vendorId): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT id, name, description, price_cents, stock, vendor_id
             FROM products WHERE id = :id AND vendor_id = :vid'
        );
        $stmt->execute([':id' => $id, ':vid' => $vendorId]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function create(int $vendorId, string $name, string $description, int $priceCents, int $stock): int
    {
        $stmt = $this->db->prepare(
            'INSERT INTO products (vendor_id, name, description, price_cents, stock, created_at)
             VALUES (:vid, :name, :desc, :price, :stock, :ts)'
        );
        $stmt->execute([
            ':vid'   => $vendorId,
            ':name'  => $name,
            ':desc'  => $description,
            ':price' => $priceCents,
            ':stock' => $stock,
            ':ts'    => gmdate('c'),
        ]);
        return (int) $this->db->lastInsertId();
    }

    /** Returns true only if a row owned by the vendor was updated. */
    public function update(int $id, int $vendorId, string $name, string $description, int $priceCents, int $stock): bool
    {
        $stmt = $this->db->prepare(
            'UPDATE products SET name = :name, description = :desc, price_cents = :price, stock = :stock
             WHERE id = :id AND vendor_id = :vid'
        );
        $stmt->execute([
            ':name'  => $name,
            ':desc'  => $description,
            ':price' => $priceCents,
            ':stock' => $stock,
            ':id'    => $id,
            ':vid'   => $vendorId,
        ]);
        return $stmt->rowCount() > 0;
    }

    public function delete(int $id, int $vendorId): bool
    {
        $stmt = $this->db->prepare('DELETE FROM products WHERE id = :id AND vendor_id = :vid');
        $stmt->execute([':id' => $id, ':vid' => $vendorId]);
        return $stmt->rowCount() > 0;
    }
}
