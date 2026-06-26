<section class="page-heading">
    <h1>Your orders</h1>
</section>

<?php if ($orders === []): ?>
    <p class="empty">No orders yet.</p>
<?php else: ?>
    <table>
        <thead><tr><th>Order</th><th>Total</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>
        <?php foreach ($orders as $order): ?>
            <tr>
                <td><a href="/orders/<?= e($order['id']) ?>">#<?= e($order['id']) ?></a></td>
                <td><?= e(money($order['total_cents'])) ?></td>
                <td><?= e($order['status']) ?></td>
                <td><?= e($order['created_at']) ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
<?php endif; ?>
