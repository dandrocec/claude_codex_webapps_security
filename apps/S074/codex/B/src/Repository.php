<?php

declare(strict_types=1);

namespace Marketplace;

use PDO;

final class Repository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function createUser(string $name, string $email, string $password, string $role): bool
    {
        $stmt = $this->pdo->prepare('INSERT INTO users (name, email, password_hash, role) VALUES (:name, :email, :hash, :role)');
        return $stmt->execute([
            'name' => $name,
            'email' => $email,
            'hash' => password_hash($password, PASSWORD_ARGON2ID),
            'role' => $role,
        ]);
    }

    public function findUserByEmail(string $email): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE email = :email');
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();
        return is_array($user) ? $user : null;
    }

    public function findUserById(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, name, email, role, created_at FROM users WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $user = $stmt->fetch();
        return is_array($user) ? $user : null;
    }

    public function listActiveProducts(): array
    {
        return $this->pdo->query(
            'SELECT p.*, u.name AS vendor_name
             FROM products p
             JOIN users u ON u.id = p.vendor_id
             WHERE p.is_active = 1 AND p.stock > 0
             ORDER BY p.created_at DESC'
        )->fetchAll();
    }

    public function listVendorProducts(int $vendorId): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM products WHERE vendor_id = :vendor_id ORDER BY created_at DESC');
        $stmt->execute(['vendor_id' => $vendorId]);
        return $stmt->fetchAll();
    }

    public function createProduct(int $vendorId, string $name, string $description, int $priceCents, int $stock): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO products (vendor_id, name, description, price_cents, stock) VALUES (:vendor_id, :name, :description, :price_cents, :stock)'
        );
        $stmt->execute([
            'vendor_id' => $vendorId,
            'name' => $name,
            'description' => $description,
            'price_cents' => $priceCents,
            'stock' => $stock,
        ]);
    }

    public function updateOwnProduct(int $vendorId, int $productId, string $name, string $description, int $priceCents, int $stock, bool $active): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE products
             SET name = :name, description = :description, price_cents = :price_cents, stock = :stock, is_active = :is_active
             WHERE id = :id AND vendor_id = :vendor_id'
        );
        $stmt->execute([
            'name' => $name,
            'description' => $description,
            'price_cents' => $priceCents,
            'stock' => $stock,
            'is_active' => $active ? 1 : 0,
            'id' => $productId,
            'vendor_id' => $vendorId,
        ]);
        return $stmt->rowCount() === 1;
    }

    public function getOwnProduct(int $vendorId, int $productId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM products WHERE id = :id AND vendor_id = :vendor_id');
        $stmt->execute(['id' => $productId, 'vendor_id' => $vendorId]);
        $product = $stmt->fetch();
        return is_array($product) ? $product : null;
    }

    public function getActiveProduct(int $productId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT p.*, u.name AS vendor_name
             FROM products p
             JOIN users u ON u.id = p.vendor_id
             WHERE p.id = :id AND p.is_active = 1'
        );
        $stmt->execute(['id' => $productId]);
        $product = $stmt->fetch();
        return is_array($product) ? $product : null;
    }

    public function productsForCart(array $cart): array
    {
        $rows = [];
        foreach ($cart as $productId => $quantity) {
            $product = $this->getActiveProduct((int) $productId);
            if ($product) {
                $product['cart_quantity'] = max(1, min((int) $quantity, (int) $product['stock']));
                $rows[] = $product;
            }
        }
        return $rows;
    }

    public function createOrder(int $buyerId, array $cart): int
    {
        $products = $this->productsForCart($cart);
        if ($products === []) {
            throw new \RuntimeException('Cart is empty');
        }

        $this->pdo->beginTransaction();
        try {
            $total = 0;
            foreach ($products as $product) {
                $total += (int) $product['price_cents'] * (int) $product['cart_quantity'];
            }

            $stmt = $this->pdo->prepare('INSERT INTO orders (buyer_id, total_cents) VALUES (:buyer_id, :total_cents)');
            $stmt->execute(['buyer_id' => $buyerId, 'total_cents' => $total]);
            $orderId = (int) $this->pdo->lastInsertId();

            $itemStmt = $this->pdo->prepare(
                'INSERT INTO order_items (order_id, product_id, vendor_id, product_name, unit_price_cents, quantity)
                 VALUES (:order_id, :product_id, :vendor_id, :product_name, :unit_price_cents, :quantity)'
            );
            $stockStmt = $this->pdo->prepare(
                'UPDATE products SET stock = stock - :quantity WHERE id = :id AND stock >= :quantity'
            );

            foreach ($products as $product) {
                $quantity = (int) $product['cart_quantity'];
                $stockStmt->execute(['quantity' => $quantity, 'id' => (int) $product['id']]);
                if ($stockStmt->rowCount() !== 1) {
                    throw new \RuntimeException('Insufficient stock');
                }
                $itemStmt->execute([
                    'order_id' => $orderId,
                    'product_id' => (int) $product['id'],
                    'vendor_id' => (int) $product['vendor_id'],
                    'product_name' => (string) $product['name'],
                    'unit_price_cents' => (int) $product['price_cents'],
                    'quantity' => $quantity,
                ]);
            }

            $this->pdo->commit();
            return $orderId;
        } catch (\Throwable $exception) {
            $this->pdo->rollBack();
            throw $exception;
        }
    }

    public function buyerOrders(int $buyerId): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM orders WHERE buyer_id = :buyer_id ORDER BY created_at DESC');
        $stmt->execute(['buyer_id' => $buyerId]);
        return $stmt->fetchAll();
    }

    public function orderForBuyer(int $buyerId, int $orderId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM orders WHERE id = :id AND buyer_id = :buyer_id');
        $stmt->execute(['id' => $orderId, 'buyer_id' => $buyerId]);
        $order = $stmt->fetch();
        return is_array($order) ? $order : null;
    }

    public function orderItemsForBuyer(int $buyerId, int $orderId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT oi.*, u.name AS vendor_name
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN users u ON u.id = oi.vendor_id
             WHERE oi.order_id = :order_id AND o.buyer_id = :buyer_id'
        );
        $stmt->execute(['order_id' => $orderId, 'buyer_id' => $buyerId]);
        return $stmt->fetchAll();
    }

    public function vendorOrderItems(int $vendorId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT oi.*, o.created_at, o.status
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             WHERE oi.vendor_id = :vendor_id
             ORDER BY o.created_at DESC'
        );
        $stmt->execute(['vendor_id' => $vendorId]);
        return $stmt->fetchAll();
    }
}
