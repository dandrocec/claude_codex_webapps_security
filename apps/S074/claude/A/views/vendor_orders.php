<?php /** @var array $orders  @var int $revenue */ ?>
<div class="toolbar">
    <h1>My orders</h1>
    <span class="role-tag">Total revenue: <strong><?= money($revenue) ?></strong></span>
</div>

<p class="muted">You only see the items from your own shop — totals reflect your products alone.</p>

<?php if (!$orders): ?>
    <div class="panel">No orders for your products yet.</div>
<?php else: ?>
    <?php foreach ($orders as $order): ?>
        <div class="panel" style="margin-bottom:16px;">
            <div class="toolbar" style="margin-bottom:10px;">
                <strong>Order #<?= (int) $order['order_id'] ?></strong>
                <span class="muted">
                    <?= e($order['order_date']) ?> · buyer: <?= e($order['buyer_name']) ?> · <?= e($order['status']) ?>
                </span>
            </div>
            <table>
                <thead><tr><th>Product</th><th>Unit price</th><th>Qty</th><th>Line total</th></tr></thead>
                <tbody>
                <?php foreach ($order['items'] as $it): ?>
                    <tr>
                        <td><?= e($it['product_name']) ?></td>
                        <td><?= money((int) $it['unit_price_cents']) ?></td>
                        <td><?= (int) $it['quantity'] ?></td>
                        <td><?= money((int) $it['unit_price_cents'] * (int) $it['quantity']) ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
                <tfoot>
                    <tr><td colspan="3" style="text-align:right; font-weight:700;">Your subtotal</td>
                        <td style="font-weight:700;"><?= money((int) $order['subtotal']) ?></td></tr>
                </tfoot>
            </table>
        </div>
    <?php endforeach; ?>
<?php endif; ?>
