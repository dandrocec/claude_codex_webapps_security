<?php
/** @var array $listings */
/** @var array $messages */

use App\Helpers;
?>
<div style="display:flex; justify-content:space-between; align-items:center; margin-top:24px;">
    <h1 style="margin:0;">My listings</h1>
    <a class="btn" href="/listings/new">+ New listing</a>
</div>

<?php if (!$listings): ?>
    <div class="empty" style="margin-top:20px;">
        <p>You haven't posted any listings yet.</p>
        <a class="btn" href="/listings/new">Post your first listing</a>
    </div>
<?php else: ?>
    <table class="table" style="margin-top:18px;">
        <thead>
            <tr><th>Listing</th><th>Location</th><th>Price</th><th>Type</th><th>Actions</th></tr>
        </thead>
        <tbody>
        <?php foreach ($listings as $l): ?>
            <tr>
                <td><a href="/listing?id=<?= (int) $l['id'] ?>"><?= Helpers::e($l['title']) ?></a></td>
                <td><?= Helpers::e($l['location']) ?></td>
                <td><?= Helpers::e(Helpers::money((int) $l['price'])) ?></td>
                <td><?= Helpers::e($l['property_type']) ?></td>
                <td>
                    <div class="actions">
                        <a class="btn btn-small btn-secondary" href="/listings/edit?id=<?= (int) $l['id'] ?>">Edit</a>
                        <form action="/listings/delete" method="post" class="inline"
                              onsubmit="return confirm('Delete this listing?');">
                            <input type="hidden" name="id" value="<?= (int) $l['id'] ?>">
                            <button type="submit" class="btn btn-small btn-danger">Delete</button>
                        </form>
                    </div>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
<?php endif; ?>

<h2 class="section-title">Inquiries from visitors</h2>
<?php if (!$messages): ?>
    <p class="muted">No messages yet. They'll appear here when visitors contact you.</p>
<?php else: ?>
    <table class="table">
        <thead>
            <tr><th>When</th><th>Listing</th><th>From</th><th>Message</th></tr>
        </thead>
        <tbody>
        <?php foreach ($messages as $m): ?>
            <tr>
                <td class="muted"><?= Helpers::e($m['created_at']) ?></td>
                <td><?= Helpers::e($m['listing_title']) ?></td>
                <td>
                    <?= Helpers::e($m['sender_name']) ?><br>
                    <span class="muted"><?= Helpers::e($m['sender_email']) ?></span>
                    <?php if ($m['sender_phone']): ?><br><span class="muted"><?= Helpers::e($m['sender_phone']) ?></span><?php endif; ?>
                </td>
                <td><?= Helpers::e($m['body']) ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
<?php endif; ?>
