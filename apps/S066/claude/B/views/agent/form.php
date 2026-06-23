<?php
/** @var array<string,mixed>|null $listing */
/** @var array<int,array<string,mixed>> $photos */
/** @var string $action */
use App\Csrf;

$v = static fn(string $key, $default = '') => $listing[$key] ?? $default;
?>
<p><a href="/dashboard">&larr; Back to dashboard</a></p>

<div class="card">
    <h1 class="page-title"><?= $listing ? 'Edit listing' : 'New listing' ?></h1>

    <form method="post" action="<?= e($action) ?>" enctype="multipart/form-data">
        <?= Csrf::field() ?>
        <?php if ($listing): ?>
            <input type="hidden" name="id" value="<?= (int) $listing['id'] ?>">
        <?php endif; ?>

        <div class="field">
            <label for="title">Title</label>
            <input id="title" name="title" type="text" required maxlength="120" value="<?= e((string) $v('title')) ?>">
        </div>
        <div class="field">
            <label for="location">Location</label>
            <input id="location" name="location" type="text" required maxlength="120" value="<?= e((string) $v('location')) ?>">
        </div>
        <div class="search-form">
            <div class="field">
                <label for="price">Price</label>
                <input id="price" name="price" type="number" min="0" step="1000" required value="<?= e((string) $v('price', '0')) ?>">
            </div>
            <div class="field">
                <label for="bedrooms">Bedrooms</label>
                <input id="bedrooms" name="bedrooms" type="number" min="0" max="100" value="<?= e((string) $v('bedrooms', '0')) ?>">
            </div>
            <div class="field">
                <label for="bathrooms">Bathrooms</label>
                <input id="bathrooms" name="bathrooms" type="number" min="0" max="100" value="<?= e((string) $v('bathrooms', '0')) ?>">
            </div>
            <div class="field">
                <label for="area_sqm">Area (m²)</label>
                <input id="area_sqm" name="area_sqm" type="number" min="0" max="1000000" value="<?= e((string) $v('area_sqm', '0')) ?>">
            </div>
        </div>
        <div class="field">
            <label for="description">Description</label>
            <textarea id="description" name="description" maxlength="4000"><?= e((string) $v('description')) ?></textarea>
        </div>
        <div class="field">
            <label for="photos">Photos (JPG, PNG, WEBP or GIF — up to 10, max 5 MB each)</label>
            <input id="photos" name="photos[]" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
        </div>

        <button type="submit" class="btn"><?= $listing ? 'Save changes' : 'Create listing' ?></button>
    </form>
</div>

<?php if ($listing && $photos): ?>
    <div class="card">
        <h2>Current photos</h2>
        <div class="photo-edit">
            <?php foreach ($photos as $p): ?>
                <figure>
                    <img src="/image?id=<?= (int) $p['id'] ?>" alt="Listing photo" width="130" height="98">
                    <form method="post" action="/listing/photo/delete" class="inline">
                        <?= Csrf::field() ?>
                        <input type="hidden" name="photo_id" value="<?= (int) $p['id'] ?>">
                        <button type="submit" class="btn btn-small btn-danger">Remove</button>
                    </form>
                </figure>
            <?php endforeach; ?>
        </div>
    </div>
<?php endif; ?>
