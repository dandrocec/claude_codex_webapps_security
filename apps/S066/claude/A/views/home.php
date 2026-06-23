<?php
/** @var array $listings */
/** @var array $filters */
/** @var bool $hasFilters */

use App\Helpers;

$types = ['House', 'Apartment', 'Condo', 'Townhouse', 'Land', 'Commercial'];
?>
<section class="hero">
    <h1>Find your next property</h1>
    <p>Browse listings from our agents. Filter by price, location, and type.</p>

    <form action="/search" method="get" class="search-bar">
        <div class="field">
            <label for="q">Keyword</label>
            <input type="text" id="q" name="q" value="<?= Helpers::e($filters['q']) ?>" placeholder="e.g. garden, modern">
        </div>
        <div class="field">
            <label for="location">Location</label>
            <input type="text" id="location" name="location" value="<?= Helpers::e($filters['location']) ?>" placeholder="City / area">
        </div>
        <div class="field">
            <label for="min_price">Min price</label>
            <input type="number" id="min_price" name="min_price" min="0" value="<?= Helpers::e($filters['min_price']) ?>" placeholder="0">
        </div>
        <div class="field">
            <label for="max_price">Max price</label>
            <input type="number" id="max_price" name="max_price" min="0" value="<?= Helpers::e($filters['max_price']) ?>" placeholder="Any">
        </div>
        <button type="submit" class="btn">Search</button>
    </form>
    <form action="/search" method="get" class="search-bar" style="grid-template-columns: 1fr auto auto; margin-top:0;">
        <div class="field">
            <label for="type">Property type</label>
            <select id="type" name="type">
                <option value="">Any type</option>
                <?php foreach ($types as $t): ?>
                    <option value="<?= Helpers::e($t) ?>" <?= $filters['type'] === $t ? 'selected' : '' ?>><?= Helpers::e($t) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <!-- carry keyword/location/price across the type filter -->
        <input type="hidden" name="q" value="<?= Helpers::e($filters['q']) ?>">
        <input type="hidden" name="location" value="<?= Helpers::e($filters['location']) ?>">
        <input type="hidden" name="min_price" value="<?= Helpers::e($filters['min_price']) ?>">
        <input type="hidden" name="max_price" value="<?= Helpers::e($filters['max_price']) ?>">
        <button type="submit" class="btn btn-secondary">Apply type</button>
        <?php if ($hasFilters): ?><a class="btn btn-secondary" href="/">Clear</a><?php endif; ?>
    </form>
</section>

<?php if ($hasFilters): ?>
    <p class="muted"><?= count($listings) ?> result<?= count($listings) === 1 ? '' : 's' ?> found.</p>
<?php endif; ?>

<?php if (!$listings): ?>
    <div class="empty">
        <p>No listings match your search yet.</p>
        <a class="btn" href="/register">Become an agent and post one</a>
    </div>
<?php else: ?>
    <div class="grid">
        <?php foreach ($listings as $l): ?>
            <a class="card" href="/listing?id=<?= (int) $l['id'] ?>">
                <div class="thumb" <?= $l['cover'] ? 'style="background-image:url(/uploads/' . Helpers::e($l['cover']) . ')"' : '' ?>>
                    <?= $l['cover'] ? '' : '🏠' ?>
                </div>
                <div class="body">
                    <span class="price"><?= Helpers::e(Helpers::money((int) $l['price'])) ?></span>
                    <h3><?= Helpers::e($l['title']) ?></h3>
                    <div class="meta">📍 <?= Helpers::e($l['location']) ?> &middot; <span class="tag"><?= Helpers::e($l['property_type']) ?></span></div>
                    <div class="specs">
                        <span>🛏 <?= (int) $l['bedrooms'] ?> bd</span>
                        <span>🛁 <?= (int) $l['bathrooms'] ?> ba</span>
                        <span>📐 <?= number_format((int) $l['area_sqft']) ?> sqft</span>
                    </div>
                </div>
            </a>
        <?php endforeach; ?>
    </div>
<?php endif; ?>
