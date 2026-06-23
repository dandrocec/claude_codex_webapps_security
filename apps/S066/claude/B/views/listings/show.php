<?php
/** @var array<string,mixed> $listing */
/** @var array<int,array<string,mixed>> $photos */
use App\Csrf;
?>
<p><a href="/">&larr; Back to results</a></p>

<div class="card">
    <h1 class="page-title"><?= e((string) $listing['title']) ?></h1>
    <div class="price"><?= e(format_price((int) $listing['price'])) ?></div>
    <p class="muted"><?= e((string) $listing['location']) ?></p>

    <?php if ($photos): ?>
        <div class="gallery">
            <?php foreach ($photos as $p): ?>
                <img src="/image?id=<?= (int) $p['id'] ?>" alt="Photo of <?= e((string) $listing['title']) ?>" loading="lazy" width="320" height="240">
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <div class="detail-grid">
        <div>
            <div class="meta">
                <span class="tag"><?= (int) $listing['bedrooms'] ?> bedrooms</span>
                <span class="tag"><?= (int) $listing['bathrooms'] ?> bathrooms</span>
                <span class="tag"><?= (int) $listing['area_sqm'] ?> m²</span>
            </div>
            <h2>About this property</h2>
            <p><?= nl2br(e((string) $listing['description'])) ?></p>
            <p class="muted">Listed by <?= e((string) $listing['agent_name']) ?></p>
        </div>

        <aside>
            <div class="card">
                <h2>Contact the agent</h2>
                <form method="post" action="/listing/contact">
                    <?= Csrf::field() ?>
                    <input type="hidden" name="listing_id" value="<?= (int) $listing['id'] ?>">
                    <div class="field">
                        <label for="sender_name">Your name</label>
                        <input id="sender_name" name="sender_name" type="text" required maxlength="80">
                    </div>
                    <div class="field">
                        <label for="sender_email">Your email</label>
                        <input id="sender_email" name="sender_email" type="email" required maxlength="190">
                    </div>
                    <div class="field">
                        <label for="body">Message</label>
                        <textarea id="body" name="body" required maxlength="2000" placeholder="I'm interested in this property…"></textarea>
                    </div>
                    <button type="submit" class="btn">Send enquiry</button>
                </form>
            </div>
        </aside>
    </div>
</div>
