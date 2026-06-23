<?php
/** @var array $listing */
/** @var array $photos */

use App\Helpers;
?>
<p><a href="/">&larr; Back to listings</a></p>

<div class="detail">
    <div>
        <?php if ($photos): ?>
            <div class="gallery">
                <?php foreach ($photos as $p): ?>
                    <img src="/uploads/<?= Helpers::e($p['filename']) ?>" alt="<?= Helpers::e($listing['title']) ?>">
                <?php endforeach; ?>
            </div>
        <?php else: ?>
            <div class="gallery"><div class="placeholder">🏠</div></div>
        <?php endif; ?>

        <h1 style="margin-bottom:4px;"><?= Helpers::e($listing['title']) ?></h1>
        <div class="muted">📍 <?= Helpers::e($listing['location']) ?>
            <?php if ($listing['address']): ?> &middot; <?= Helpers::e($listing['address']) ?><?php endif; ?>
            &middot; <span class="tag"><?= Helpers::e($listing['property_type']) ?></span>
        </div>

        <p class="price"><?= Helpers::e(Helpers::money((int) $listing['price'])) ?></p>

        <div class="specs-row">
            <div><strong><?= (int) $listing['bedrooms'] ?></strong> Bedrooms</div>
            <div><strong><?= (int) $listing['bathrooms'] ?></strong> Bathrooms</div>
            <div><strong><?= number_format((int) $listing['area_sqft']) ?></strong> sqft</div>
        </div>

        <h3>About this property</h3>
        <p style="white-space:pre-wrap;"><?= Helpers::e($listing['description'] ?: 'No description provided.') ?></p>
    </div>

    <aside>
        <div class="panel">
            <h3>Contact the agent</h3>
            <p class="muted" style="margin-top:-8px;">
                <?= Helpers::e($listing['agent_name']) ?>
                <?php if ($listing['agent_phone']): ?><br>📞 <?= Helpers::e($listing['agent_phone']) ?><?php endif; ?>
            </p>
            <form action="/contact" method="post">
                <input type="hidden" name="listing_id" value="<?= (int) $listing['id'] ?>">
                <div class="form-group">
                    <label for="sender_name">Your name</label>
                    <input type="text" id="sender_name" name="sender_name" required>
                </div>
                <div class="form-group">
                    <label for="sender_email">Your email</label>
                    <input type="email" id="sender_email" name="sender_email" required>
                </div>
                <div class="form-group">
                    <label for="sender_phone">Your phone (optional)</label>
                    <input type="text" id="sender_phone" name="sender_phone">
                </div>
                <div class="form-group">
                    <label for="body">Message</label>
                    <textarea id="body" name="body" rows="4" required>I'm interested in this property. Please contact me.</textarea>
                </div>
                <button type="submit" class="btn" style="width:100%;">Send message</button>
            </form>
        </div>
    </aside>
</div>
