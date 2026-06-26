<section class="page-heading">
    <h1>Vendor dashboard</h1>
    <p>Manage your products and review orders for your products only.</p>
</section>

<section class="panel">
    <h2>Add product</h2>
    <form method="post" action="/vendor/products" class="stack">
        <input type="hidden" name="csrf_token" value="<?= e($csrf->token()) ?>">
        <label>Name <input name="name" maxlength="120" required></label>
        <label>Description <textarea name="description" maxlength="1000" required></textarea></label>
        <label>Price <input name="price" inputmode="decimal" pattern="^\d{1,7}(\.\d{1,2})?$" required></label>
        <label>Stock <input type="number" name="stock" min="0" max="100000" required></label>
        <button type="submit">Create product</button>
    </form>
</section>

<section class="panel">
    <h2>Your products</h2>
    <?php if ($products === []): ?>
        <p class="empty">No products yet.</p>
    <?php else: ?>
        <table>
            <thead><tr><th>Name</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead>
            <tbody>
            <?php foreach ($products as $product): ?>
                <tr>
                    <td><?= e($product['name']) ?></td>
                    <td><?= e(money($product['price_cents'])) ?></td>
                    <td><?= e($product['stock']) ?></td>
                    <td><?= ((int) $product['is_active']) === 1 ? 'Active' : 'Hidden' ?></td>
                    <td><a href="/vendor/products/<?= e($product['id']) ?>/edit">Edit</a></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>
</section>

<section class="panel">
    <h2>Orders for your products</h2>
    <?php if ($orders === []): ?>
        <p class="empty">No orders yet.</p>
    <?php else: ?>
        <table>
            <thead><tr><th>Order</th><th>Product</th><th>Quantity</th><th>Total</th><th>Date</th></tr></thead>
            <tbody>
            <?php foreach ($orders as $item): ?>
                <tr>
                    <td>#<?= e($item['order_id']) ?></td>
                    <td><?= e($item['product_name']) ?></td>
                    <td><?= e($item['quantity']) ?></td>
                    <td><?= e(money((int) $item['unit_price_cents'] * (int) $item['quantity'])) ?></td>
                    <td><?= e($item['created_at']) ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>
</section>
