<?php
/** @var array<int,array<string,mixed>> $orders */
use function App\e;
use function App\money;
?>
<h1>Orders for my products</h1>
<p class="muted">You only see the line items for products you sell. Other vendors' items and buyers' full order totals are never shown to you.</p>

<?php if ($orders === []): ?>
    <div class="empty">No orders for your products yet.</div>
<?php else: ?>
    <?php foreach ($orders as $order): ?>
        <div class="order">
            <header>
                <strong>Order #<?= (int) $order['order_id'] ?></strong>
                <span>
                    <span class="tag">buyer: <?= e($order['buyer_name']) ?></span>
                    <span class="muted"><?= e(date('M j, Y H:i', strtotime((string) $order['created_at']))) ?></span>
                </span>
            </header>
            <table>
                <thead>
                    <tr><th>Product</th><th class="right">Unit</th><th>Qty</th><th class="right">Subtotal</th></tr>
                </thead>
                <tbody>
                <?php foreach ($order['items'] as $item): ?>
                    <tr>
                        <td><?= e($item['product_name']) ?></td>
                        <td class="right"><?= e(money((int) $item['unit_price_cents'])) ?></td>
                        <td><?= (int) $item['quantity'] ?></td>
                        <td class="right"><?= e(money((int) $item['unit_price_cents'] * (int) $item['quantity'])) ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
                <tfoot>
                    <tr><th colspan="3" class="right">Your earnings from this order</th><th class="right"><?= e(money((int) $order['subtotal'])) ?></th></tr>
                </tfoot>
            </table>
        </div>
    <?php endforeach; ?>
<?php endif; ?>
