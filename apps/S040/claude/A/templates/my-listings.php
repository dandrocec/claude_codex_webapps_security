<?php
/** @var array $listings */
?>

<div class="page-head">
    <h1>My listings</h1>
    <a href="/sell" class="btn btn-primary">+ Post an item</a>
</div>

<?php if (!$listings): ?>
    <div class="empty">
        <p>You haven't posted anything yet.</p>
        <a href="/sell" class="btn btn-primary">Post your first item</a>
    </div>
<?php else: ?>
    <table class="listing-table">
        <thead>
            <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Price</th>
                <th>Posted</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($listings as $listing): ?>
                <tr>
                    <td><a href="/listing?id=<?= (int) $listing['id'] ?>"><?= e($listing['title']) ?></a></td>
                    <td><?= e($listing['category_name']) ?></td>
                    <td><?= e(money((float) $listing['price'])) ?></td>
                    <td><?= e($listing['created_at']) ?></td>
                    <td class="row-actions">
                        <a href="/edit?id=<?= (int) $listing['id'] ?>">Edit</a>
                        <form action="/delete" method="post" class="inline-form"
                              onsubmit="return confirm('Delete this listing?');">
                            <?= csrf_field() ?>
                            <input type="hidden" name="id" value="<?= (int) $listing['id'] ?>">
                            <button type="submit" class="link-button danger">Delete</button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
<?php endif; ?>
