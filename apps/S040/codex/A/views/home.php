<section class="toolbar">
    <div>
        <h1>Find local items for sale</h1>
        <p>Browse listings from nearby sellers.</p>
    </div>
    <form class="search-form" method="get" action="/">
        <input type="search" name="q" value="<?= e($query) ?>" placeholder="Search listings">
        <select name="category">
            <option value="">All categories</option>
            <?php foreach (categories() as $category): ?>
                <option value="<?= e($category) ?>" <?= $selectedCategory === $category ? 'selected' : '' ?>>
                    <?= e($category) ?>
                </option>
            <?php endforeach; ?>
        </select>
        <button type="submit">Search</button>
    </form>
</section>

<div class="category-row">
    <a class="<?= $selectedCategory === '' ? 'active' : '' ?>" href="/">All</a>
    <?php foreach (categories() as $category): ?>
        <a class="<?= $selectedCategory === $category ? 'active' : '' ?>" href="/?category=<?= urlencode($category) ?>">
            <?= e($category) ?>
        </a>
    <?php endforeach; ?>
</div>

<?php if (!$listings): ?>
    <div class="empty">No listings found.</div>
<?php else: ?>
    <div class="listing-grid">
        <?php foreach ($listings as $listing): ?>
            <article class="listing-card">
                <a href="/listings/<?= (int) $listing['id'] ?>">
                    <?php if ($listing['photo_path']): ?>
                        <img src="<?= e($listing['photo_path']) ?>" alt="">
                    <?php else: ?>
                        <div class="placeholder">No photo</div>
                    <?php endif; ?>
                    <div class="listing-body">
                        <span class="category"><?= e($listing['category']) ?></span>
                        <h2><?= e($listing['title']) ?></h2>
                        <strong><?= money((int) $listing['price']) ?></strong>
                        <p>Seller: <?= e($listing['seller_name']) ?></p>
                    </div>
                </a>
            </article>
        <?php endforeach; ?>
    </div>
<?php endif; ?>
