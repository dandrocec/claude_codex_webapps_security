<?php
/** @var array|null $listing */
/** @var array $categories */
/** @var array $old */
/** @var array $errors */
/** @var string $action */
$errors = $errors ?? [];
$isEdit = $listing !== null;
$val = static fn (string $key) => e((string) ($old[$key] ?? ''));
$selectedCat = (int) ($old['category_id'] ?? 0);
?>

<h1><?= $isEdit ? 'Edit listing' : 'Post an item for sale' ?></h1>

<?php if ($errors): ?>
    <div class="flash flash-error">
        <ul>
            <?php foreach ($errors as $error): ?>
                <li><?= e($error) ?></li>
            <?php endforeach; ?>
        </ul>
    </div>
<?php endif; ?>

<form action="<?= e($action) ?>" method="post" enctype="multipart/form-data" class="form">
    <?= csrf_field() ?>

    <label>
        Title
        <input type="text" name="title" maxlength="120" required value="<?= $val('title') ?>">
    </label>

    <label>
        Category
        <select name="category_id" required>
            <option value="">Choose a category…</option>
            <?php foreach ($categories as $cat): ?>
                <option value="<?= (int) $cat['id'] ?>" <?= $selectedCat === (int) $cat['id'] ? 'selected' : '' ?>>
                    <?= e($cat['name']) ?>
                </option>
            <?php endforeach; ?>
        </select>
    </label>

    <label>
        Price (USD)
        <input type="number" name="price" min="0" step="0.01" required value="<?= $val('price') ?>">
    </label>

    <label>
        Description
        <textarea name="description" rows="6" placeholder="Describe the item, its condition, etc."><?= $val('description') ?></textarea>
    </label>

    <label>
        Photo <?= $isEdit ? '(leave empty to keep the current photo)' : '(optional)' ?>
        <input type="file" name="photo" accept="image/jpeg,image/png,image/gif,image/webp">
    </label>

    <?php if ($isEdit && $listing['photo']): ?>
        <div class="current-photo">
            <span>Current photo:</span>
            <img src="/uploads/<?= e($listing['photo']) ?>" alt="Current photo">
        </div>
    <?php endif; ?>

    <div class="form-actions">
        <button type="submit" class="btn btn-primary"><?= $isEdit ? 'Save changes' : 'Post listing' ?></button>
        <a href="<?= $isEdit ? '/listing?id=' . (int) $listing['id'] : '/' ?>" class="btn">Cancel</a>
    </div>
</form>
