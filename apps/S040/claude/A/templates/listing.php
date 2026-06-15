<?php
/** @var array $listing */
$user = \App\Auth::user();
$isOwner = $user && (int) $user['id'] === (int) $listing['user_id'];
?>

<p><a href="/" class="back-link">&larr; Back to listings</a></p>

<article class="detail">
    <div class="detail-photo">
        <?php if ($listing['photo']): ?>
            <img src="/uploads/<?= e($listing['photo']) ?>" alt="<?= e($listing['title']) ?>">
        <?php else: ?>
            <span class="no-photo">No photo provided</span>
        <?php endif; ?>
    </div>

    <div class="detail-info">
        <span class="card-category"><?= e($listing['category_name']) ?></span>
        <h1><?= e($listing['title']) ?></h1>
        <p class="detail-price"><?= e(money((float) $listing['price'])) ?></p>

        <?php if (trim((string) $listing['description']) !== ''): ?>
            <div class="detail-description"><?= nl2br(e($listing['description'])) ?></div>
        <?php endif; ?>

        <p class="detail-meta">
            Sold by <strong><?= e($listing['seller']) ?></strong><br>
            Posted <?= e($listing['created_at']) ?>
        </p>

        <?php if ($isOwner): ?>
            <div class="owner-actions">
                <a href="/edit?id=<?= (int) $listing['id'] ?>" class="btn">Edit</a>
                <form action="/delete" method="post" class="inline-form"
                      onsubmit="return confirm('Delete this listing? This cannot be undone.');">
                    <?= csrf_field() ?>
                    <input type="hidden" name="id" value="<?= (int) $listing['id'] ?>">
                    <button type="submit" class="btn btn-danger">Delete</button>
                </form>
            </div>
        <?php endif; ?>
    </div>
</article>
