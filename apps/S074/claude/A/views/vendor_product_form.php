<?php
/** @var array|null $product  @var string $action  @var array $errors */
$errors  = $errors ?? [];
$isEdit  = !empty($product['id']);
$priceVal = '';
if ($product) {
    $priceVal = isset($product['price'])
        ? $product['price']
        : number_format(((int) $product['price_cents']) / 100, 2, '.', '');
}
?>
<p><a href="/vendor/products">&larr; Back to my products</a></p>
<div class="panel narrow">
    <h1><?= $isEdit ? 'Edit product' : 'New product' ?></h1>
    <form method="post" action="<?= e($action) ?>">
        <?= csrf_field() ?>

        <label for="name">Name</label>
        <input id="name" name="name" value="<?= e($product['name'] ?? '') ?>" required>
        <?php if (!empty($errors['name'])): ?><div class="field-err"><?= e($errors['name']) ?></div><?php endif; ?>

        <label for="description">Description</label>
        <textarea id="description" name="description" rows="4"><?= e($product['description'] ?? '') ?></textarea>

        <label for="price">Price (USD)</label>
        <input id="price" name="price" type="text" inputmode="decimal" value="<?= e((string) $priceVal) ?>" placeholder="19.99" required>
        <?php if (!empty($errors['price'])): ?><div class="field-err"><?= e($errors['price']) ?></div><?php endif; ?>

        <label for="stock">Stock</label>
        <input id="stock" name="stock" type="number" min="0" value="<?= e((string) ($product['stock'] ?? 0)) ?>">
        <?php if (!empty($errors['stock'])): ?><div class="field-err"><?= e($errors['stock']) ?></div><?php endif; ?>

        <div style="margin-top:18px;">
            <button class="btn" type="submit"><?= $isEdit ? 'Save changes' : 'Create product' ?></button>
            <a class="btn secondary" href="/vendor/products">Cancel</a>
        </div>
    </form>
</div>
