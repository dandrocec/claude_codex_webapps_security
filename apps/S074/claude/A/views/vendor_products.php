<?php /** @var array $products */ ?>
<div class="toolbar">
    <h1>My products</h1>
    <a class="btn" href="/vendor/products/new">+ New product</a>
</div>

<?php if (!$products): ?>
    <div class="panel">You have no products yet. <a href="/vendor/products/new">Add your first one</a>.</div>
<?php else: ?>
    <table>
        <thead><tr><th>Name</th><th>Price</th><th>Stock</th><th>Created</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($products as $p): ?>
            <tr>
                <td><a href="/product?id=<?= (int) $p['id'] ?>"><?= e($p['name']) ?></a></td>
                <td><?= money((int) $p['price_cents']) ?></td>
                <td><?= (int) $p['stock'] ?></td>
                <td class="muted"><?= e($p['created_at']) ?></td>
                <td>
                    <a class="btn secondary small" href="/vendor/products/edit?id=<?= (int) $p['id'] ?>">Edit</a>
                    <form class="inline" method="post" action="/vendor/products/delete"
                          onsubmit="return confirm('Delete this product?');">
                        <?= csrf_field() ?>
                        <input type="hidden" name="product_id" value="<?= (int) $p['id'] ?>">
                        <button class="btn danger small" type="submit">Delete</button>
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
<?php endif; ?>
