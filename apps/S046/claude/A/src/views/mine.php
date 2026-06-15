<?php /** @var array $quotes */ ?>
<h1>My quotes</h1>

<p><a class="button" href="?page=submit">+ Submit a new quote</a></p>

<?php if (!$quotes): ?>
    <p class="empty">You haven't submitted any quotes yet.</p>
<?php else: ?>
    <ul class="quote-list">
        <?php foreach ($quotes as $q): ?>
            <li class="quote-card">
                <blockquote><?= nl2br(e($q['text'])) ?></blockquote>
                <p class="byline">— <?= e($q['author']) ?></p>
                <p class="meta">
                    <?php if ((int) $q['approved'] === 1): ?>
                        <span class="badge approved">Approved</span>
                    <?php else: ?>
                        <span class="badge pending">Pending review</span>
                    <?php endif; ?>
                    <a href="?page=edit&id=<?= (int) $q['id'] ?>">Edit</a>
                </p>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>
