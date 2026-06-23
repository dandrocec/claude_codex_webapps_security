<?php
/** @var string $mode  'create' | 'edit' */
/** @var array<string,mixed> $product */
/** @var array<string,string> $errors */
use App\Csrf;
use function App\e;
$isEdit = $mode === 'edit';
$action = $isEdit ? '/vendor/products/update?id=' . (int) $product['id'] : '/vendor/products';
$priceValue = isset($product['price_cents']) ? number_format(((int) $product['price_cents']) / 100, 2, '.', '') : '';
?>
<h1><?= $isEdit ? 'Edit product' : 'Add a product' ?></h1>

<form class="stack" method="post" action="<?= e($action) ?>">
    <?= Csrf::field() ?>
    <div class="field">
        <label for="name">Name</label>
        <input id="name" type="text" name="name" value="<?= e($product['name'] ?? '') ?>" required maxlength="120">
        <?php if (isset($errors['name'])): ?><div class="err"><?= e($errors['name']) ?></div><?php endif; ?>
    </div>
    <div class="field">
        <label for="description">Description</label>
        <textarea id="description" name="description" maxlength="2000"><?= e($product['description'] ?? '') ?></textarea>
        <?php if (isset($errors['description'])): ?><div class="err"><?= e($errors['description']) ?></div><?php endif; ?>
    </div>
    <div class="field">
        <label for="price">Price (USD)</label>
        <input id="price" type="text" name="price" value="<?= e($priceValue) ?>" inputmode="decimal" placeholder="19.99" required>
        <?php if (isset($errors['price'])): ?><div class="err"><?= e($errors['price']) ?></div><?php endif; ?>
    </div>
    <div class="field">
        <label for="stock">Stock</label>
        <input id="stock" type="number" name="stock" value="<?= (int) ($product['stock'] ?? 0) ?>" min="0" max="100000" required>
        <?php if (isset($errors['stock'])): ?><div class="err"><?= e($errors['stock']) ?></div><?php endif; ?>
    </div>
    <button class="btn" type="submit"><?= $isEdit ? 'Save changes' : 'Create product' ?></button>
    <a href="/vendor/products" style="margin-left:10px">Cancel</a>
</form>
