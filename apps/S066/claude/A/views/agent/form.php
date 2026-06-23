<?php
/** @var array|null $listing */
/** @var array $photos */

use App\Helpers;

$isEdit = $listing !== null;
$photos = $photos ?? [];
$action = $isEdit ? '/listings/update' : '/listings';
$v = static fn(string $k, $default = '') => Helpers::e($listing[$k] ?? $default);
$types = ['House', 'Apartment', 'Condo', 'Townhouse', 'Land', 'Commercial'];
?>
<h1><?= $isEdit ? 'Edit listing' : 'New listing' ?></h1>

<form class="form-card" action="<?= $action ?>" method="post" enctype="multipart/form-data">
    <?php if ($isEdit): ?>
        <input type="hidden" name="id" value="<?= (int) $listing['id'] ?>">
    <?php endif; ?>

    <div class="form-group">
        <label for="title">Title</label>
        <input type="text" id="title" name="title" value="<?= $v('title') ?>" required placeholder="Bright 2-bed apartment near the park">
    </div>

    <div class="form-row">
        <div class="form-group">
            <label for="price">Price (USD)</label>
            <input type="number" id="price" name="price" min="1" value="<?= $v('price') ?>" required>
        </div>
        <div class="form-group">
            <label for="property_type">Property type</label>
            <select id="property_type" name="property_type">
                <?php foreach ($types as $t): ?>
                    <option value="<?= Helpers::e($t) ?>" <?= ($listing['property_type'] ?? 'House') === $t ? 'selected' : '' ?>><?= Helpers::e($t) ?></option>
                <?php endforeach; ?>
            </select>
        </div>
    </div>

    <div class="form-row">
        <div class="form-group">
            <label for="location">Location (city / area)</label>
            <input type="text" id="location" name="location" value="<?= $v('location') ?>" required placeholder="Austin, TX">
        </div>
        <div class="form-group">
            <label for="address">Street address (optional)</label>
            <input type="text" id="address" name="address" value="<?= $v('address') ?>">
        </div>
    </div>

    <div class="form-row" style="grid-template-columns:1fr 1fr 1fr;">
        <div class="form-group">
            <label for="bedrooms">Bedrooms</label>
            <input type="number" id="bedrooms" name="bedrooms" min="0" value="<?= $v('bedrooms', '0') ?>">
        </div>
        <div class="form-group">
            <label for="bathrooms">Bathrooms</label>
            <input type="number" id="bathrooms" name="bathrooms" min="0" value="<?= $v('bathrooms', '0') ?>">
        </div>
        <div class="form-group">
            <label for="area_sqft">Area (sqft)</label>
            <input type="number" id="area_sqft" name="area_sqft" min="0" value="<?= $v('area_sqft', '0') ?>">
        </div>
    </div>

    <div class="form-group">
        <label for="description">Description</label>
        <textarea id="description" name="description" rows="5" placeholder="Describe the property..."><?= $v('description') ?></textarea>
    </div>

    <div class="form-group">
        <label for="photos">Photos (JPG/PNG/GIF/WebP, up to 5MB each)</label>
        <input type="file" id="photos" name="photos[]" accept="image/*" multiple>
        <?php if ($isEdit && $photos): ?>
            <div class="thumb-list">
                <?php foreach ($photos as $p): ?>
                    <img src="/uploads/<?= Helpers::e($p['filename']) ?>" alt="">
                <?php endforeach; ?>
            </div>
            <span class="muted">Newly uploaded photos are added to the existing ones.</span>
        <?php endif; ?>
    </div>

    <div class="actions">
        <button type="submit" class="btn"><?= $isEdit ? 'Save changes' : 'Publish listing' ?></button>
        <a class="btn btn-secondary" href="/dashboard">Cancel</a>
    </div>
</form>
