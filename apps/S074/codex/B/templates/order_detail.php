<section class="page-heading">
    <h1>Order #<?= e($order['id']) ?></h1>
    <p><?= e($order['status']) ?> on <?= e($order['created_at']) ?></p>
</section>

<table>
    <thead><tr><th>Product</th><th>Vendor</th><th>Price</th><th>Quantity</th><th>Subtotal</th></tr></thead>
    <tbody>
    <?php foreach ($items as $item): ?>
        <tr>
            <td><?= e($item['product_name']) ?></td>
            <td><?= e($item['vendor_name']) ?></td>
            <td><?= e(money($item['unit_price_cents'])) ?></td>
            <td><?= e($item['quantity']) ?></td>
            <td><?= e(money((int) $item['unit_price_cents'] * (int) $item['quantity'])) ?></td>
        </tr>
    <?php endforeach; ?>
    </tbody>
    <tfoot><tr><th colspan="4">Total</th><th><?= e(money($order['total_cents'])) ?></th></tr></tfoot>
</table>
