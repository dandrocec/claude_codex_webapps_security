<?php
/** @var string $mode */
/** @var array $old */
/** @var array $errors */
/** @var array $categories */
/** @var ?array $listing */
$action = $mode === 'edit' ? '/edit' : '/sell';
?>
<div class="form-wrap">
    <h1><?= $mode === 'edit' ? 'Edit listing' : 'Post an item for sale' ?></h1>

    <form action="<?= e($action) ?>" method="post" enctype="multipart/form-data" novalidate>
        <?= csrf_field() ?>
        <?php if ($mode === 'edit'): ?>
            <input type="hidden" name="id" value="<?= (int) ($old['id'] ?? $listing['id']) ?>">
        <?php endif; ?>

        <label>
            Title
            <input type="text" name="title" maxlength="140" required
                   value="<?= e($old['title'] ?? '') ?>">
            <?php if (!empty($errors['title'])): ?><span class="err"><?= e($errors['title']) ?></span><?php endif; ?>
        </label>

        <label>
            Category
            <select name="category_id" required>
                <option value="">— Choose —</option>
                <?php foreach ($categories as $c): ?>
                    <option value="<?= (int) $c['id'] ?>"
                        <?= ((string) ($old['category_id'] ?? '') === (string) $c['id']) ? 'selected' : '' ?>>
                        <?= e($c['name']) ?>
                    </option>
                <?php endforeach; ?>
            </select>
            <?php if (!empty($errors['category_id'])): ?><span class="err"><?= e($errors['category_id']) ?></span><?php endif; ?>
        </label>

        <label>
            Price (USD)
            <input type="number" name="price" step="0.01" min="0" max="1000000" required
                   value="<?= e($old['price'] ?? '') ?>">
            <?php if (!empty($errors['price'])): ?><span class="err"><?= e($errors['price']) ?></span><?php endif; ?>
        </label>

        <label>
            Description
            <textarea name="description" rows="6" maxlength="5000" required><?= e($old['description'] ?? '') ?></textarea>
            <?php if (!empty($errors['description'])): ?><span class="err"><?= e($errors['description']) ?></span><?php endif; ?>
        </label>

        <label>
            Photo <?= $mode === 'edit' ? '(leave empty to keep the current one)' : '(optional)' ?>
            <input type="file" name="photo" accept="image/jpeg,image/png,image/gif,image/webp">
            <?php if (!empty($errors['photo'])): ?><span class="err"><?= e($errors['photo']) ?></span><?php endif; ?>
        </label>

        <?php if ($mode === 'edit' && !empty($listing['photo_path'])): ?>
            <div class="current-photo">
                <span>Current photo:</span><br>
                <img src="/<?= e($listing['photo_path']) ?>" alt="Current photo" width="160">
            </div>
        <?php endif; ?>

        <div class="actions">
            <button type="submit" class="btn btn-primary"><?= $mode === 'edit' ? 'Save changes' : 'Post listing' ?></button>
            <a class="btn" href="<?= $mode === 'edit' ? '/item?id=' . (int) ($old['id'] ?? $listing['id']) : '/' ?>">Cancel</a>
        </div>
    </form>
</div>
