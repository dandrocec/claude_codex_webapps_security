<?php
/** @var array<int,array<string,mixed>> $products */
use App\Csrf;
use function App\e;
use function App\money;
?>
<div class="toolbar">
    <h1>My products</h1>
    <a class="btn" href="/vendor/products/new">+ Add product</a>
</div>

<?php if ($products === []): ?>
    <div class="empty">You have not listed any products yet. <a href="/vendor/products/new">Add your first product</a>.</div>
<?php else: ?>
    <table>
        <thead>
            <tr><th>Name</th><th class="right">Price</th><th>Stock</th><th>Added</th><th></th></tr>
        </thead>
        <tbody>
        <?php foreach ($products as $p): ?>
            <tr>
                <td><?= e($p['name']) ?></td>
                <td class="right"><?= e(money((int) $p['price_cents'])) ?></td>
                <td><?= (int) $p['stock'] ?></td>
                <td class="muted"><?= e(date('M j, Y', strtotime((string) $p['created_at']))) ?></td>
                <td class="right">
                    <a class="btn btn-sm btn-ghost" href="/vendor/products/edit?id=<?= (int) $p['id'] ?>">Edit</a>
                    <form method="post" action="/vendor/products/delete" class="inline" onsubmit="return confirm('Delete this product?');">
                        <?= Csrf::field() ?>
                        <input type="hidden" name="id" value="<?= (int) $p['id'] ?>">
                        <button class="btn btn-sm btn-danger" type="submit">Delete</button>
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
<?php endif; ?>
