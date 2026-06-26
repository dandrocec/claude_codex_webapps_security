<section class="page-heading">
    <h1>Cart</h1>
    <p>One cart can contain items from multiple vendors.</p>
</section>

<?php if ($products === []): ?>
    <p class="empty">Your cart is empty.</p>
<?php else: ?>
    <?php $total = 0; ?>
    <form method="post" action="/cart/update">
        <input type="hidden" name="csrf_token" value="<?= e($csrf->token()) ?>">
        <table>
            <thead><tr><th>Product</th><th>Vendor</th><th>Price</th><th>Quantity</th><th>Subtotal</th></tr></thead>
            <tbody>
            <?php foreach ($products as $product): ?>
                <?php $subtotal = (int) $product['price_cents'] * (int) $product['cart_quantity']; $total += $subtotal; ?>
                <tr>
                    <td><?= e($product['name']) ?></td>
                    <td><?= e($product['vendor_name']) ?></td>
                    <td><?= e(money($product['price_cents'])) ?></td>
                    <td><input type="number" name="quantities[<?= e($product['id']) ?>]" min="0" max="<?= e($product['stock']) ?>" value="<?= e($product['cart_quantity']) ?>"></td>
                    <td><?= e(money($subtotal)) ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
            <tfoot><tr><th colspan="4">Total</th><th><?= e(money($total)) ?></th></tr></tfoot>
        </table>
        <button type="submit">Update cart</button>
    </form>
    <form method="post" action="/checkout" class="checkout">
        <input type="hidden" name="csrf_token" value="<?= e($csrf->token()) ?>">
        <button type="submit">Place order</button>
    </form>
<?php endif; ?>
