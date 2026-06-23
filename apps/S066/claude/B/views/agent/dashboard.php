<?php
/** @var array<int,array<string,mixed>> $listings */
/** @var array<int,array<string,mixed>> $inquiries */
use App\Csrf;
?>
<h1 class="page-title">My listings</h1>
<p><a class="btn" href="/listing/new">+ New listing</a></p>

<?php if (!$listings): ?>
    <div class="card"><p>You haven't posted any listings yet. <a href="/listing/new">Create your first one</a>.</p></div>
<?php else: ?>
    <div class="card">
        <table class="table">
            <thead>
                <tr><th>Title</th><th>Location</th><th>Price</th><th>Photos</th><th>Actions</th></tr>
            </thead>
            <tbody>
            <?php foreach ($listings as $l): ?>
                <tr>
                    <td><a href="/listing?id=<?= (int) $l['id'] ?>"><?= e((string) $l['title']) ?></a></td>
                    <td><?= e((string) $l['location']) ?></td>
                    <td><?= e(format_price((int) $l['price'])) ?></td>
                    <td><?= (int) $l['photo_count'] ?></td>
                    <td>
                        <div class="row-actions">
                            <a class="btn btn-small btn-ghost" href="/listing/edit?id=<?= (int) $l['id'] ?>">Edit</a>
                            <form method="post" action="/listing/delete" class="inline">
                                <?= Csrf::field() ?>
                                <input type="hidden" name="id" value="<?= (int) $l['id'] ?>">
                                <button type="submit" class="btn btn-small btn-danger">Delete</button>
                            </form>
                        </div>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
<?php endif; ?>

<h2>Recent enquiries</h2>
<?php if (!$inquiries): ?>
    <div class="card"><p class="muted">No enquiries yet.</p></div>
<?php else: ?>
    <div class="card">
        <table class="table">
            <thead><tr><th>When</th><th>Listing</th><th>From</th><th>Message</th></tr></thead>
            <tbody>
            <?php foreach ($inquiries as $i): ?>
                <tr>
                    <td class="muted"><?= e((string) $i['created_at']) ?></td>
                    <td><?= e((string) $i['listing_title']) ?></td>
                    <td>
                        <?= e((string) $i['sender_name']) ?><br>
                        <a href="mailto:<?= e((string) $i['sender_email']) ?>"><?= e((string) $i['sender_email']) ?></a>
                    </td>
                    <td><?= nl2br(e((string) $i['body'])) ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
<?php endif; ?>
