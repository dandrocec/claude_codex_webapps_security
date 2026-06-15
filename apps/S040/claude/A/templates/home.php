<?php
/** @var array $listings */
/** @var int $total */
/** @var int $page */
/** @var int $perPage */
/** @var string $keyword */
/** @var int|null $categoryId */
/** @var array $categories */

$totalPages = (int) max(1, ceil($total / $perPage));

/** Build a URL to a results page, preserving the current filters. */
$pageUrl = static function (int $p) use ($keyword, $categoryId): string {
    $query = array_filter([
        'q' => $keyword !== '' ? $keyword : null,
        'category' => $categoryId,
        'page' => $p > 1 ? $p : null,
    ], static fn ($v) => $v !== null && $v !== '');
    return '/' . ($query ? '?' . http_build_query($query) : '');
};
?>

<section class="hero">
    <h1>Browse the marketplace</h1>
    <form action="/" method="get" class="search-bar">
        <input type="search" name="q" placeholder="Search listings…" value="<?= e($keyword) ?>">
        <select name="category">
            <option value="">All categories</option>
            <?php foreach ($categories as $cat): ?>
                <option value="<?= (int) $cat['id'] ?>" <?= $categoryId === (int) $cat['id'] ? 'selected' : '' ?>>
                    <?= e($cat['name']) ?>
                </option>
            <?php endforeach; ?>
        </select>
        <button type="submit" class="btn btn-primary">Search</button>
    </form>
</section>

<p class="results-count">
    <?= $total ?> listing<?= $total === 1 ? '' : 's' ?> found<?php
        if ($keyword !== '') echo ' for &ldquo;' . e($keyword) . '&rdquo;'; ?>.
</p>

<?php if (!$listings): ?>
    <div class="empty">
        <p>No listings match your search yet.</p>
        <?php if (\App\Auth::check()): ?>
            <a href="/sell" class="btn btn-primary">Be the first to post an item</a>
        <?php else: ?>
            <a href="/register" class="btn btn-primary">Register to post an item</a>
        <?php endif; ?>
    </div>
<?php else: ?>
    <div class="grid">
        <?php foreach ($listings as $listing): ?>
            <a class="card" href="/listing?id=<?= (int) $listing['id'] ?>">
                <div class="card-photo">
                    <?php if ($listing['photo']): ?>
                        <img src="/uploads/<?= e($listing['photo']) ?>" alt="<?= e($listing['title']) ?>">
                    <?php else: ?>
                        <span class="no-photo">No photo</span>
                    <?php endif; ?>
                </div>
                <div class="card-body">
                    <span class="card-category"><?= e($listing['category_name']) ?></span>
                    <h3 class="card-title"><?= e($listing['title']) ?></h3>
                    <span class="card-price"><?= e(money((float) $listing['price'])) ?></span>
                </div>
            </a>
        <?php endforeach; ?>
    </div>

    <?php if ($totalPages > 1): ?>
        <nav class="pagination">
            <?php if ($page > 1): ?>
                <a href="<?= e($pageUrl($page - 1)) ?>">&larr; Prev</a>
            <?php endif; ?>
            <span>Page <?= $page ?> of <?= $totalPages ?></span>
            <?php if ($page < $totalPages): ?>
                <a href="<?= e($pageUrl($page + 1)) ?>">Next &rarr;</a>
            <?php endif; ?>
        </nav>
    <?php endif; ?>
<?php endif; ?>
