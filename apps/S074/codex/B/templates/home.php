<section class="page-heading">
    <h1>Marketplace</h1>
    <p>Shop products from independent vendors in one cart.</p>
</section>

<?php if ($products === []): ?>
    <p class="empty">No active products are available yet.</p>
<?php else: ?>
    <div class="grid">
        <?php foreach ($products as $product): ?>
            <article class="card">
                <div class="card-header">
                    <h2><?= e($product['name']) ?></h2>
                    <span><?= e($product['vendor_name']) ?></span>
                </div>
                <p><?= e($product['description']) ?></p>
                <p class="price"><?= e(money($product['price_cents'])) ?></p>
                <p class="muted"><?= e($product['stock']) ?> in stock</p>
                <form method="post" action="/cart/add" class="row-form">
                    <input type="hidden" name="csrf_token" value="<?= e($csrf->token()) ?>">
                    <input type="hidden" name="product_id" value="<?= e($product['id']) ?>">
                    <label>
                        Quantity
                        <input type="number" name="quantity" min="1" max="<?= e($product['stock']) ?>" value="1" required>
                    </label>
                    <button type="submit">Add to cart</button>
                </form>
            </article>
        <?php endforeach; ?>
    </div>
<?php endif; ?>
