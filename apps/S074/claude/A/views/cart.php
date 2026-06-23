<?php /** @var array $items  @var int $total */ ?>
<h1>Your cart</h1>

<?php if (!$items): ?>
    <div class="panel">Your cart is empty. <a href="/">Start shopping</a>.</div>
<?php else: ?>
    <table>
        <thead>
            <tr><th>Product</th><th>Vendor</th><th>Price</th><th>Qty</th><th>Line total</th><th></th></tr>
        </thead>
        <tbody>
        <?php foreach ($items as $item): $p = $item['product']; ?>
            <tr>
                <td><a href="/product?id=<?= (int) $p['id'] ?>"><?= e($p['name']) ?></a></td>
                <td class="muted"><?= e($p['shop_name'] ?: $p['vendor_name']) ?></td>
                <td><?= money((int) $p['price_cents']) ?></td>
                <td style="max-width:130px;">
                    <form class="inline" method="post" action="/cart/update" style="display:flex; gap:6px;">
                        <?= csrf_field() ?>
                        <input type="hidden" name="product_id" value="<?= (int) $p['id'] ?>">
                        <input type="number" name="quantity" value="<?= (int) $item['quantity'] ?>" min="0"
                               style="width:64px;">
                        <button class="btn secondary small" type="submit">Update</button>
                    </form>
                </td>
                <td><?= money((int) $item['line_total']) ?></td>
                <td>
                    <form class="inline" method="post" action="/cart/remove">
                        <?= csrf_field() ?>
                        <input type="hidden" name="product_id" value="<?= (int) $p['id'] ?>">
                        <button class="btn danger small" type="submit">Remove</button>
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
        <tfoot>
            <tr><td colspan="4" style="text-align:right; font-weight:700;">Total</td>
                <td colspan="2" style="font-weight:700;"><?= money($total) ?></td></tr>
        </tfoot>
    </table>

    <div class="toolbar" style="margin-top:18px;">
        <a href="/">&larr; Continue shopping</a>
        <?php $u = current_user(); ?>
        <?php if ($u && $u['role'] === 'buyer'): ?>
            <form method="post" action="/checkout">
                <?= csrf_field() ?>
                <button class="btn" type="submit">Checkout (<?= money($total) ?>)</button>
            </form>
        <?php elseif ($u && $u['role'] === 'vendor'): ?>
            <span class="muted">Vendor accounts cannot check out. Use a buyer account.</span>
        <?php else: ?>
            <a class="btn" href="/login">Log in to check out</a>
        <?php endif; ?>
    </div>
<?php endif; ?>
