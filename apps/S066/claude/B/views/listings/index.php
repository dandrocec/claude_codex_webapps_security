<?php
/** @var array<int,array<string,mixed>> $listings */
/** @var array<string,mixed> $filters */
?>
<div class="card">
    <h1 class="page-title">Find your next property</h1>
    <form method="get" action="/" class="search-form">
        <div class="field field-wide">
            <label for="q">Keyword</label>
            <input id="q" name="q" type="text" value="<?= e((string) $filters['q']) ?>" placeholder="title, description…" maxlength="100">
        </div>
        <div class="field field-wide">
            <label for="location">Location</label>
            <input id="location" name="location" type="text" value="<?= e((string) $filters['location']) ?>" placeholder="City or area" maxlength="100">
        </div>
        <div class="field">
            <label for="min_price">Min price</label>
            <input id="min_price" name="min_price" type="number" min="0" step="1000" value="<?= $filters['min_price'] !== null ? e((string) $filters['min_price']) : '' ?>">
        </div>
        <div class="field">
            <label for="max_price">Max price</label>
            <input id="max_price" name="max_price" type="number" min="0" step="1000" value="<?= $filters['max_price'] !== null ? e((string) $filters['max_price']) : '' ?>">
        </div>
        <div class="field">
            <label for="beds">Min beds</label>
            <input id="beds" name="beds" type="number" min="0" step="1" value="<?= $filters['beds'] !== null ? e((string) $filters['beds']) : '' ?>">
        </div>
        <div class="field">
            <label>&nbsp;</label>
            <button type="submit" class="btn">Search</button>
        </div>
    </form>
</div>

<p class="muted"><?= count($listings) ?> propert<?= count($listings) === 1 ? 'y' : 'ies' ?> found.</p>

<?php if (!$listings): ?>
    <div class="card"><p>No properties match your search. Try widening your filters.</p></div>
<?php else: ?>
    <div class="grid">
        <?php foreach ($listings as $l): ?>
            <article class="listing-card">
                <a href="/listing?id=<?= (int) $l['id'] ?>">
                    <?php if (!empty($l['cover_photo_id'])): ?>
                        <img class="thumb" src="/image?id=<?= (int) $l['cover_photo_id'] ?>" alt="<?= e((string) $l['title']) ?>" loading="lazy" width="320" height="240">
                    <?php else: ?>
                        <span class="thumb placeholder">No photo</span>
                    <?php endif; ?>
                </a>
                <div class="body">
                    <div class="price"><?= e(format_price((int) $l['price'])) ?></div>
                    <h3><a href="/listing?id=<?= (int) $l['id'] ?>"><?= e((string) $l['title']) ?></a></h3>
                    <div class="muted"><?= e((string) $l['location']) ?></div>
                    <div class="meta">
                        <span><?= (int) $l['bedrooms'] ?> bd</span>
                        <span><?= (int) $l['bathrooms'] ?> ba</span>
                        <span><?= (int) $l['area_sqm'] ?> m²</span>
                    </div>
                </div>
            </article>
        <?php endforeach; ?>
    </div>
<?php endif; ?>
