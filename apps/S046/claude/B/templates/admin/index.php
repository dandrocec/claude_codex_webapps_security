<?php /** @var array $pending */ ?>
<section class="page-head">
    <h1>Moderation queue</h1>
    <p class="muted">Approve quotes to publish them, or reject to remove them.</p>
</section>

<?php if ($pending === []): ?>
    <p class="empty">Nothing pending. All caught up.</p>
<?php else: ?>
    <ul class="quote-list">
        <?php foreach ($pending as $q): ?>
            <li class="quote">
                <blockquote><?= nl2br(e((string) $q['text'])) ?></blockquote>
                <p class="byline">&mdash; <?= e((string) $q['author']) ?>
                    <span class="muted">(by <?= e((string) $q['submitter']) ?>)</span>
                </p>
                <p class="meta">
                    <form class="inline" method="post" action="/admin/<?= (int) $q['id'] ?>/approve">
                        <?= \App\Csrf::field() ?>
                        <button type="submit">Approve</button>
                    </form>
                    <form class="inline" method="post" action="/admin/<?= (int) $q['id'] ?>/reject">
                        <?= \App\Csrf::field() ?>
                        <button type="submit" class="link-button">Reject</button>
                    </form>
                </p>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>
