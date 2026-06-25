<section class="searchbar">
    <form method="get" action="/">
        <input name="q" value="<?= e($q ?? '') ?>" placeholder="Search listings">
        <select name="category">
            <option value="">All categories</option>
            <?php foreach ($categories as $cat): ?>
                <option value="<?= e($cat['id']) ?>" <?= ($selectedCategory ?? null) === (int)$cat['id'] ? 'selected' : '' ?>><?= e($cat['name']) ?></option>
            <?php endforeach; ?>
        </select>
        <button type="submit">Search</button>
    </form>
</section>

<section class="grid">
    <?php foreach ($listings as $item): ?>
        <article class="card">
            <a href="/listing?id=<?= e($item['id']) ?>">
                <img src="<?= e($item['photo_path']) ?>" alt="">
                <div class="card-body">
                    <h2><?= e($item['title']) ?></h2>
                    <p class="price"><?= e(money((int)$item['price_cents'])) ?></p>
                    <p><?= e($item['category_name']) ?></p>
                </div>
            </a>
        </article>
    <?php endforeach; ?>
    <?php if (!$listings): ?>
        <p>No listings found.</p>
    <?php endif; ?>
</section>
