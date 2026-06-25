<?php $isEdit = isset($listing['id']); ?>
<section class="panel">
    <h1><?= $isEdit ? 'Edit listing' : 'Post item' ?></h1>
    <?php require __DIR__ . '/partials/errors.php'; ?>
    <form method="post" action="<?= $isEdit ? '/listing/edit' : '/listing/new' ?>" enctype="multipart/form-data">
        <?= csrf_field() ?>
        <?php if ($isEdit): ?><input type="hidden" name="id" value="<?= e($listing['id']) ?>"><?php endif; ?>
        <label>Title <input name="title" required maxlength="120" value="<?= e($listing['title'] ?? '') ?>"></label>
        <label>Category
            <select name="category_id" required>
                <?php foreach ($categories as $cat): ?>
                    <option value="<?= e($cat['id']) ?>" <?= (int)($listing['category_id'] ?? 0) === (int)$cat['id'] ? 'selected' : '' ?>><?= e($cat['name']) ?></option>
                <?php endforeach; ?>
            </select>
        </label>
        <label>Price <input name="price" type="number" min="0" max="100000000" step="0.01" required value="<?= isset($listing['price_cents']) ? e(number_format((int)$listing['price_cents'] / 100, 2, '.', '')) : '' ?>"></label>
        <label>Description <textarea name="description" required maxlength="3000"><?= e($listing['description'] ?? '') ?></textarea></label>
        <label>Photo <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" <?= $isEdit ? '' : 'required' ?>></label>
        <?php if ($isEdit && !empty($listing['photo_path'])): ?><img class="thumb" src="<?= e($listing['photo_path']) ?>" alt=""><?php endif; ?>
        <button type="submit"><?= $isEdit ? 'Save changes' : 'Create listing' ?></button>
    </form>
</section>
