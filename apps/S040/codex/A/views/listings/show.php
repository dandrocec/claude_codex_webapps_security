<article class="detail">
    <div class="detail-media">
        <?php if ($listing['photo_path']): ?>
            <img src="<?= e($listing['photo_path']) ?>" alt="">
        <?php else: ?>
            <div class="placeholder large">No photo</div>
        <?php endif; ?>
    </div>
    <div class="detail-copy">
        <span class="category"><?= e($listing['category']) ?></span>
        <h1><?= e($listing['title']) ?></h1>
        <strong class="price"><?= money((int) $listing['price']) ?></strong>
        <p><?= nl2br(e($listing['description'])) ?></p>
        <div class="seller-box">
            <h2>Seller</h2>
            <p><?= e($listing['seller_name']) ?></p>
            <a href="mailto:<?= e($listing['seller_email']) ?>"><?= e($listing['seller_email']) ?></a>
        </div>
        <?php if ($currentUser && (int) $currentUser['id'] === (int) $listing['user_id']): ?>
            <div class="actions inline">
                <a href="/listings/<?= (int) $listing['id'] ?>/edit">Edit</a>
                <form method="post" action="/listings/<?= (int) $listing['id'] ?>/delete" onsubmit="return confirm('Remove this listing?')">
                    <button type="submit">Delete</button>
                </form>
            </div>
        <?php endif; ?>
    </div>
</article>
