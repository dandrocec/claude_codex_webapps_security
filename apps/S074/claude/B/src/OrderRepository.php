<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Order persistence and checkout. Checkout runs in a single transaction with
 * row-level stock re-checks, so prices/stock are authoritative server-side.
 */
final class OrderRepository
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::connection();
    }

    /**
     * Place an order for a buyer from a cart of product_id => quantity.
     *
     * @param array<int,int> $cart
     * @return array{ok:bool,orderId?:int,error?:string}
     */
    public function checkout(int $buyerId, array $cart): array
    {
        if ($cart === []) {
            return ['ok' => false, 'error' => 'Your cart is empty.'];
        }

        $this->db->beginTransaction();
        try {
            $total = 0;
            $lines = [];

            foreach ($cart as $productId => $qty) {
                $productId = (int) $productId;
                $qty = (int) $qty;
                if ($qty <= 0) {
                    continue;
                }

                // Lock-read the product; prices come from the DB, never the client.
                $stmt = $this->db->prepare(
                    'SELECT id, vendor_id, name, price_cents, stock FROM products WHERE id = :id'
                );
                $stmt->execute([':id' => $productId]);
                $product = $stmt->fetch();

                if ($product === false) {
                    throw new \DomainException('A product in your cart is no longer available.');
                }
                if ((int) $product['stock'] < $qty) {
                    throw new \DomainException('Not enough stock for "' . $product['name'] . '".');
                }

                $lineTotal = (int) $product['price_cents'] * $qty;
                $total += $lineTotal;
                $lines[] = [
                    'product_id'      => (int) $product['id'],
                    'vendor_id'       => (int) $product['vendor_id'],
                    'product_name'    => (string) $product['name'],
                    'unit_price_cents'=> (int) $product['price_cents'],
                    'quantity'        => $qty,
                ];
            }

            if ($lines === []) {
                throw new \DomainException('Your cart is empty.');
            }

            $orderStmt = $this->db->prepare(
                'INSERT INTO orders (buyer_id, total_cents, status, created_at)
                 VALUES (:buyer, :total, :status, :ts)'
            );
            $orderStmt->execute([
                ':buyer'  => $buyerId,
                ':total'  => $total,
                ':status' => 'paid',
                ':ts'     => gmdate('c'),
            ]);
            $orderId = (int) $this->db->lastInsertId();

            $itemStmt = $this->db->prepare(
                'INSERT INTO order_items
                    (order_id, product_id, vendor_id, product_name, unit_price_cents, quantity)
                 VALUES (:oid, :pid, :vid, :pname, :price, :qty)'
            );
            $stockStmt = $this->db->prepare(
                'UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty'
            );

            foreach ($lines as $line) {
                $itemStmt->execute([
                    ':oid'   => $orderId,
                    ':pid'   => $line['product_id'],
                    ':vid'   => $line['vendor_id'],
                    ':pname' => $line['product_name'],
                    ':price' => $line['unit_price_cents'],
                    ':qty'   => $line['quantity'],
                ]);
                $stockStmt->execute([':qty' => $line['quantity'], ':id' => $line['product_id']]);
                if ($stockStmt->rowCount() === 0) {
                    throw new \DomainException('Stock changed during checkout. Please review your cart.');
                }
            }

            $this->db->commit();
            return ['ok' => true, 'orderId' => $orderId];
        } catch (\DomainException $e) {
            $this->db->rollBack();
            return ['ok' => false, 'error' => $e->getMessage()];
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /** Orders belonging to a buyer (with their line items). */
    public function forBuyer(int $buyerId): array
    {
        $stmt = $this->db->prepare(
            'SELECT id, total_cents, status, created_at FROM orders
             WHERE buyer_id = :bid ORDER BY created_at DESC, id DESC'
        );
        $stmt->execute([':bid' => $buyerId]);
        $orders = $stmt->fetchAll();

        foreach ($orders as &$order) {
            $items = $this->db->prepare(
                'SELECT product_name, unit_price_cents, quantity FROM order_items WHERE order_id = :oid'
            );
            $items->execute([':oid' => $order['id']]);
            $order['items'] = $items->fetchAll();
        }
        unset($order);
        return $orders;
    }

    /**
     * Order lines visible to ONE vendor: only that vendor's items, grouped by
     * order. A vendor never sees another vendor's line items, the buyer's other
     * purchases, or the full order total (prevents cross-vendor data leakage).
     */
    public function forVendor(int $vendorId): array
    {
        $stmt = $this->db->prepare(
            'SELECT oi.order_id, oi.product_name, oi.unit_price_cents, oi.quantity,
                    o.created_at, o.status, u.name AS buyer_name
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN users u  ON u.id = o.buyer_id
             WHERE oi.vendor_id = :vid
             ORDER BY o.created_at DESC, oi.order_id DESC'
        );
        $stmt->execute([':vid' => $vendorId]);
        $rows = $stmt->fetchAll();

        $grouped = [];
        foreach ($rows as $row) {
            $oid = (int) $row['order_id'];
            if (!isset($grouped[$oid])) {
                $grouped[$oid] = [
                    'order_id'    => $oid,
                    'created_at'  => $row['created_at'],
                    'status'      => $row['status'],
                    'buyer_name'  => $row['buyer_name'],
                    'items'       => [],
                    'subtotal'    => 0,
                ];
            }
            $grouped[$oid]['items'][] = $row;
            $grouped[$oid]['subtotal'] += (int) $row['unit_price_cents'] * (int) $row['quantity'];
        }
        return array_values($grouped);
    }
}
