<?php /** @var array $products  @var string $search */ ?>
<div class="toolbar">
    <h1>Shop all vendors</h1>
    <form method="get" action="/" style="display:flex; gap:8px; max-width:360px; width:100%;">
        <input type="search" name="q" placeholder="Search products…" value="<?= e($search) ?>">
        <button class="btn" type="submit">Search</button>
    </form>
</div>

<?php if ($search !== ''): ?>
    <p class="muted">Showing results for “<?= e($search) ?>”. <a href="/">Clear</a></p>
<?php endif; ?>

<?php if (!$products): ?>
    <div class="panel">No products found.</div>
<?php else: ?>
    <div class="grid">
        <?php foreach ($products as $p): ?>
            <div class="card">
                <h3><a href="/product?id=<?= (int) $p['id'] ?>"><?= e($p['name']) ?></a></h3>
                <p class="muted">Sold by <?= e($p['shop_name'] ?: $p['vendor_name']) ?></p>
                <p class="muted"><?= e(strlen($p['description']) > 80 ? substr($p['description'], 0, 79) . '…' : $p['description']) ?></p>
                <p class="price"><?= money((int) $p['price_cents']) ?></p>
                <?php if ($p['stock'] > 0): ?>
                    <form class="inline" method="post" action="/cart/add">
                        <?= csrf_field() ?>
                        <input type="hidden" name="product_id" value="<?= (int) $p['id'] ?>">
                        <button class="btn small" type="submit">Add to cart</button>
                    </form>
                <?php else: ?>
                    <span class="role-tag">Out of stock</span>
                <?php endif; ?>
            </div>
        <?php endforeach; ?>
    </div>
<?php endif; ?>
