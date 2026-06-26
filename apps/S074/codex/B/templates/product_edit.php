<section class="auth-panel wide">
    <h1>Edit product</h1>
    <form method="post" action="/vendor/products/<?= e($product['id'] ?? 0) ?>" class="stack">
        <input type="hidden" name="csrf_token" value="<?= e($csrf->token()) ?>">
        <label>Name <input name="name" maxlength="120" value="<?= e($product['name'] ?? '') ?>" required></label>
        <label>Description <textarea name="description" maxlength="1000" required><?= e($product['description'] ?? '') ?></textarea></label>
        <label>Price <input name="price" inputmode="decimal" value="<?= e(price_value($product['price_cents'] ?? 0)) ?>" pattern="^\d{1,7}(\.\d{1,2})?$" required></label>
        <label>Stock <input type="number" name="stock" min="0" max="100000" value="<?= e($product['stock'] ?? 0) ?>" required></label>
        <label class="check"><input type="checkbox" name="is_active" <?= ((int) ($product['is_active'] ?? 0)) === 1 ? 'checked' : '' ?>> Active</label>
        <button type="submit">Save product</button>
    </form>
</section>
