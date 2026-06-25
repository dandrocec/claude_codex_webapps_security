<article class="detail">
    <img src="<?= e($listing['photo_path']) ?>" alt="">
    <div>
        <p class="category"><?= e($listing['category_name']) ?></p>
        <h1><?= e($listing['title']) ?></h1>
        <p class="price"><?= e(money((int)$listing['price_cents'])) ?></p>
        <p><?= nl2br(e($listing['description'])) ?></p>
        <p class="muted">Seller: <?= e($listing['seller_email']) ?></p>
        <?php if (App\Security::userId() === (int)$listing['user_id']): ?>
            <div class="actions">
                <a class="button" href="/listing/edit?id=<?= e($listing['id']) ?>">Edit</a>
                <form method="post" action="/listing/delete" onsubmit="return confirm('Delete this listing?')">
                    <?= csrf_field() ?>
                    <input type="hidden" name="id" value="<?= e($listing['id']) ?>">
                    <button class="danger" type="submit">Delete</button>
                </form>
            </div>
        <?php endif; ?>
    </div>
</article>
