<?php
/** @var array<int,array<string,mixed>> $products */
/** @var string $search */
use App\Csrf;
use function App\e;
use function App\money;
?>
<div class="toolbar">
    <h1>Browse the marketplace</h1>
    <form class="searchform" method="get" action="/">
        <input type="search" name="q" value="<?= e($search) ?>" placeholder="Search products…" maxlength="100">
        <button class="btn" type="submit">Search</button>
    </form>
</div>

<?php if ($products === []): ?>
    <div class="empty">
        <?php if ($search !== ''): ?>
            No products match “<?= e($search) ?>”.
        <?php else: ?>
            No products are available yet. Check back soon!
        <?php endif; ?>
    </div>
<?php else: ?>
    <div class="grid">
        <?php foreach ($products as $p): ?>
            <div class="card">
                <h3><a href="/product?id=<?= (int) $p['id'] ?>"><?= e($p['name']) ?></a></h3>
                <div class="vendor">by <?= e($p['vendor_name']) ?></div>
                <p class="desc"><?= e(mb_strimwidth((string) $p['description'], 0, 90, '…')) ?></p>
                <div class="price"><?= e(money((int) $p['price_cents'])) ?></div>
                <div class="stock"><?= (int) $p['stock'] ?> in stock</div>
                <form method="post" action="/cart/add" style="margin-top:10px">
                    <?= Csrf::field() ?>
                    <input type="hidden" name="product_id" value="<?= (int) $p['id'] ?>">
                    <input type="hidden" name="quantity" value="1">
                    <button class="btn btn-sm" type="submit">Add to cart</button>
                </form>
            </div>
        <?php endforeach; ?>
    </div>
<?php endif; ?>
