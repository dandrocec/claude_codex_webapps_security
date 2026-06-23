<?php /** @var array $product */ ?>
<p><a href="/">&larr; Back to shop</a></p>
<div class="panel">
    <h1><?= e($product['name']) ?></h1>
    <p class="muted">Sold by <strong><?= e($product['shop_name'] ?: $product['vendor_name']) ?></strong></p>
    <p class="price"><?= money((int) $product['price_cents']) ?></p>
    <p><?= nl2br(e($product['description'])) ?></p>
    <p class="muted">
        <?= $product['stock'] > 0 ? (int) $product['stock'] . ' in stock' : 'Currently out of stock' ?>
    </p>
    <?php if ($product['stock'] > 0): ?>
        <form method="post" action="/cart/add" style="display:flex; gap:10px; max-width:240px; align-items:flex-end;">
            <?= csrf_field() ?>
            <input type="hidden" name="product_id" value="<?= (int) $product['id'] ?>">
            <div style="width:90px;">
                <label for="qty">Qty</label>
                <input id="qty" type="number" name="quantity" value="1" min="1" max="<?= (int) $product['stock'] ?>">
            </div>
            <button class="btn" type="submit">Add to cart</button>
        </form>
    <?php endif; ?>
</div>
