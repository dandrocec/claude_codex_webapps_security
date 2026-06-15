<?php
/** @var array $listing */
/** @var bool $isOwner */
?>
<p><a href="/" class="back">← Back to listings</a></p>

<article class="detail">
    <div class="detail-photo">
        <?php if ($listing['photo_path']): ?>
            <img src="/<?= e($listing['photo_path']) ?>" alt="<?= e($listing['title']) ?>">
        <?php else: ?>
            <div class="no-photo large">No photo</div>
        <?php endif; ?>
    </div>
    <div class="detail-info">
        <h1><?= e($listing['title']) ?></h1>
        <p class="price big"><?= e(money((int) $listing['price_cents'])) ?></p>
        <p class="meta">
            <span class="badge"><?= e($listing['category_name']) ?></span>
            Sold by <?= e($listing['seller_name']) ?>
        </p>
        <h2>Description</h2>
        <p class="description"><?= nl2br(e($listing['description'])) ?></p>

        <?php if ($isOwner): ?>
            <div class="owner-actions">
                <a class="btn" href="/edit?id=<?= (int) $listing['id'] ?>">Edit</a>
                <form action="/delete" method="post" class="inline"
                      data-confirm="Delete this listing? This cannot be undone.">
                    <?= csrf_field() ?>
                    <input type="hidden" name="id" value="<?= (int) $listing['id'] ?>">
                    <button type="submit" class="btn btn-danger">Delete</button>
                </form>
            </div>
        <?php endif; ?>
    </div>
</article>
