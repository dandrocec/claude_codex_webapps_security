<?php /** @var array $pending */ ?>
<h1>Review queue</h1>

<?php if (!$pending): ?>
    <p class="empty">Nothing waiting for review. 🎉</p>
<?php else: ?>
    <ul class="quote-list">
        <?php foreach ($pending as $q): ?>
            <li class="quote-card">
                <blockquote><?= nl2br(e($q['text'])) ?></blockquote>
                <p class="byline">— <?= e($q['author']) ?>
                    <span class="submitter">(by @<?= e($q['username']) ?>)</span>
                </p>
                <form method="post" action="?page=admin" class="inline">
                    <?= csrf_field() ?>
                    <input type="hidden" name="id" value="<?= (int) $q['id'] ?>">
                    <button type="submit">Approve</button>
                </form>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>
