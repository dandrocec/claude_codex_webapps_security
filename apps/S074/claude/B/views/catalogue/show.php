<?php
/** @var array<string,mixed> $product */
use App\Csrf;
use function App\e;
use function App\money;
$inStock = (int) $product['stock'] > 0;
?>
<p><a href="/">← Back to all products</a></p>

<div class="card" style="max-width:620px">
    <h1><?= e($product['name']) ?></h1>
    <div class="vendor">Sold by <?= e($product['vendor_name']) ?></div>
    <p class="desc"><?= nl2br(e($product['description'])) ?></p>
    <div class="price"><?= e(money((int) $product['price_cents'])) ?></div>
    <div class="stock">
        <?php if ($inStock): ?>
            <?= (int) $product['stock'] ?> in stock
        <?php else: ?>
            <span class="out">Out of stock</span>
        <?php endif; ?>
    </div>

    <?php if ($inStock): ?>
        <form method="post" action="/cart/add" style="margin-top:14px; display:flex; gap:10px; align-items:flex-end">
            <?= Csrf::field() ?>
            <input type="hidden" name="product_id" value="<?= (int) $product['id'] ?>">
            <div class="field" style="margin:0">
                <label for="quantity">Quantity</label>
                <input class="qtybox" id="quantity" type="number" name="quantity" value="1" min="1" max="<?= min(99, (int) $product['stock']) ?>">
            </div>
            <button class="btn" type="submit">Add to cart</button>
        </form>
    <?php endif; ?>
</div>
