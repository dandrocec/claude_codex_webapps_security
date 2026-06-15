<?php
/** @var array $listings */
/** @var array $categories */
/** @var string $q */
/** @var ?array $activeCat */
?>
<div class="layout">
    <aside class="sidebar">
        <h2>Categories</h2>
        <ul class="cat-list">
            <li class="<?= $activeCat === null ? 'active' : '' ?>"><a href="/">All categories</a></li>
            <?php foreach ($categories as $c): ?>
                <li class="<?= ($activeCat && $activeCat['id'] === $c['id']) ? 'active' : '' ?>">
                    <a href="/?category=<?= e(urlencode($c['slug'])) ?><?= $q !== '' ? '&q=' . e(urlencode($q)) : '' ?>">
                        <?= e($c['name']) ?>
                    </a>
                </li>
            <?php endforeach; ?>
        </ul>
    </aside>

    <section class="content">
        <h1>
            <?php if ($activeCat): ?>
                <?= e($activeCat['name']) ?>
            <?php else: ?>
                Latest listings
            <?php endif; ?>
        </h1>
        <?php if ($q !== ''): ?>
            <p class="muted">Search results for “<?= e($q) ?>”</p>
        <?php endif; ?>

        <?php if (!$listings): ?>
            <p class="empty">No listings found. <?php if (is_logged_in()): ?><a href="/sell">Post the first one!</a><?php endif; ?></p>
        <?php else: ?>
            <div class="grid">
                <?php foreach ($listings as $l): ?>
                    <a class="card" href="/item?id=<?= (int) $l['id'] ?>">
                        <div class="thumb">
                            <?php if ($l['photo_path']): ?>
                                <img src="/<?= e($l['photo_path']) ?>" alt="<?= e($l['title']) ?>" loading="lazy">
                            <?php else: ?>
                                <span class="no-photo">No photo</span>
                            <?php endif; ?>
                        </div>
                        <div class="card-body">
                            <span class="price"><?= e(money((int) $l['price_cents'])) ?></span>
                            <h3><?= e($l['title']) ?></h3>
                            <span class="meta"><?= e($l['category_name']) ?> · <?= e($l['seller_name']) ?></span>
                        </div>
                    </a>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </section>
</div>
