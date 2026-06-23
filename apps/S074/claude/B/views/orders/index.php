<?php
/** @var array<int,array<string,mixed>> $orders */
use function App\e;
use function App\money;
?>
<h1>My orders</h1>

<?php if ($orders === []): ?>
    <div class="empty">You have not placed any orders yet. <a href="/">Browse products</a>.</div>
<?php else: ?>
    <?php foreach ($orders as $order): ?>
        <div class="order">
            <header>
                <strong>Order #<?= (int) $order['id'] ?></strong>
                <span class="muted"><?= e(date('M j, Y H:i', strtotime((string) $order['created_at']))) ?></span>
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
                    <tr><th colspan="3" class="right">Total</th><th class="right"><?= e(money((int) $order['total_cents'])) ?></th></tr>
                </tfoot>
            </table>
        </div>
    <?php endforeach; ?>
<?php endif; ?>
