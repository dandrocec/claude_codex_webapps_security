<section class="toolbar">
    <div>
        <h1>My listings</h1>
        <p>Manage the items you are selling.</p>
    </div>
    <a class="button" href="/listings/new">Post item</a>
</section>

<?php if (!$listings): ?>
    <div class="empty">You have not posted any listings yet.</div>
<?php else: ?>
    <div class="manage-list">
        <?php foreach ($listings as $listing): ?>
            <article class="manage-item">
                <?php if ($listing['photo_path']): ?>
                    <img src="<?= e($listing['photo_path']) ?>" alt="">
                <?php else: ?>
                    <div class="thumb-placeholder">No photo</div>
                <?php endif; ?>
                <div>
                    <span class="category"><?= e($listing['category']) ?></span>
                    <h2><?= e($listing['title']) ?></h2>
                    <strong><?= money((int) $listing['price']) ?></strong>
                </div>
                <div class="actions">
                    <a href="/listings/<?= (int) $listing['id'] ?>">View</a>
                    <a href="/listings/<?= (int) $listing['id'] ?>/edit">Edit</a>
                    <form method="post" action="/listings/<?= (int) $listing['id'] ?>/delete" onsubmit="return confirm('Remove this listing?')">
                        <button type="submit">Delete</button>
                    </form>
                </div>
            </article>
        <?php endforeach; ?>
    </div>
<?php endif; ?>
