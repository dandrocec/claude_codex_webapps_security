<?php
$isEdit = is_array($listing) && isset($listing['id']);
$selected = old($listing ?? [], 'category');
$priceValue = '';
if (is_array($listing) && isset($listing['price'])) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $priceValue = (string) $listing['price'];
    } else {
        $priceValue = number_format(((int) $listing['price']) / 100, 2, '.', '');
    }
}
?>

<section class="form-panel">
    <h1><?= $isEdit ? 'Edit listing' : 'Post an item' ?></h1>
    <?php require BASE_PATH . '/views/partials/errors.php'; ?>
    <form method="post" action="<?= e($action) ?>" enctype="multipart/form-data">
        <label>Title
            <input type="text" name="title" value="<?= e(old($listing ?? [], 'title')) ?>" required>
        </label>
        <label>Category
            <select name="category" required>
                <option value="">Choose a category</option>
                <?php foreach (categories() as $category): ?>
                    <option value="<?= e($category) ?>" <?= $selected === $category ? 'selected' : '' ?>>
                        <?= e($category) ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </label>
        <label>Price
            <input type="number" name="price" value="<?= e($priceValue) ?>" min="0.01" step="0.01" required>
        </label>
        <label>Description
            <textarea name="description" rows="7" required><?= e(old($listing ?? [], 'description')) ?></textarea>
        </label>
        <label>Photo
            <input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/gif">
        </label>
        <?php if ($isEdit && !empty($listing['photo_path'])): ?>
            <img class="current-photo" src="<?= e($listing['photo_path']) ?>" alt="">
        <?php endif; ?>
        <button type="submit"><?= e($buttonText) ?></button>
    </form>
</section>
