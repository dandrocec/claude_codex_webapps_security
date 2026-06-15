<?php
/** @var array $listings */
?>
<div class="form-wrap">
    <div class="head-row">
        <h1>My listings</h1>
        <a class="btn btn-primary" href="/sell">+ New listing</a>
    </div>

    <?php if (!$listings): ?>
        <p class="empty">You have no listings yet. <a href="/sell">Post one now.</a></p>
    <?php else: ?>
        <table class="listing-table">
            <thead>
                <tr><th></th><th>Title</th><th>Category</th><th>Price</th><th>Actions</th></tr>
            </thead>
            <tbody>
            <?php foreach ($listings as $l): ?>
                <tr>
                    <td class="tcell-thumb">
                        <?php if ($l['photo_path']): ?>
                            <img src="/<?= e($l['photo_path']) ?>" alt="" width="56" height="56">
                        <?php endif; ?>
                    </td>
                    <td><a href="/item?id=<?= (int) $l['id'] ?>"><?= e($l['title']) ?></a></td>
                    <td><?= e($l['category_name']) ?></td>
                    <td><?= e(money((int) $l['price_cents'])) ?></td>
                    <td class="row-actions">
                        <a href="/edit?id=<?= (int) $l['id'] ?>">Edit</a>
                        <form action="/delete" method="post" class="inline"
                              data-confirm="Delete this listing?">
                            <?= csrf_field() ?>
                            <input type="hidden" name="id" value="<?= (int) $l['id'] ?>">
                            <button type="submit" class="linklike danger">Delete</button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>
</div>
