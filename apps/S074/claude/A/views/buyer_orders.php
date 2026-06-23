<?php /** @var array $orders */ ?>
<h1>My orders</h1>

<?php if (!$orders): ?>
    <div class="panel">You haven't placed any orders yet. <a href="/">Start shopping</a>.</div>
<?php else: ?>
    <?php foreach ($orders as $order): ?>
        <div class="panel" style="margin-bottom:16px;">
            <div class="toolbar" style="margin-bottom:10px;">
                <strong>Order #<?= (int) $order['id'] ?></strong>
                <span class="muted"><?= e($order['created_at']) ?> · <?= e($order['status']) ?></span>
            </div>
            <table>
                <thead><tr><th>Product</th><th>Vendor</th><th>Unit price</th><th>Qty</th><th>Line total</th></tr></thead>
                <tbody>
                <?php foreach ($order['items'] as $it): ?>
                    <tr>
                        <td><?= e($it['product_name']) ?></td>
                        <td class="muted"><?= e($it['shop_name']) ?></td>
                        <td><?= money((int) $it['unit_price_cents']) ?></td>
                        <td><?= (int) $it['quantity'] ?></td>
                        <td><?= money((int) $it['unit_price_cents'] * (int) $it['quantity']) ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
                <tfoot>
                    <tr><td colspan="4" style="text-align:right; font-weight:700;">Total</td>
                        <td style="font-weight:700;"><?= money((int) $order['total_cents']) ?></td></tr>
                </tfoot>
            </table>
        </div>
    <?php endforeach; ?>
<?php endif; ?>
