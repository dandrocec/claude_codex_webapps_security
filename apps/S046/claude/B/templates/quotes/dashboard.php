<?php
/** @var array $quotes */
/** @var array $user */
?>
<section class="page-head">
    <h1>My quotes</h1>
    <p class="muted">Signed in as <strong><?= e((string) $user['username']) ?></strong>.
        New and edited quotes are re-reviewed before appearing publicly.</p>
    <a class="button" href="/quotes/new">Submit a new quote</a>
</section>

<?php if ($quotes === []): ?>
    <p class="empty">You haven't submitted any quotes yet.</p>
<?php else: ?>
    <ul class="quote-list">
        <?php foreach ($quotes as $q): ?>
            <li class="quote">
                <blockquote><?= nl2br(e((string) $q['text'])) ?></blockquote>
                <p class="byline">&mdash; <?= e((string) $q['author']) ?></p>
                <p class="meta">
                    <?php if ((int) $q['approved'] === 1): ?>
                        <span class="badge badge-approved">Approved</span>
                    <?php else: ?>
                        <span class="badge badge-pending">Pending review</span>
                    <?php endif; ?>
                    <a href="/quotes/<?= (int) $q['id'] ?>/edit">Edit</a>
                </p>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>
