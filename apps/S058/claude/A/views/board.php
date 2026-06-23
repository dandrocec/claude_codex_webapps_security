<?php /** @var array $board */ ?>
<?php /** @var array $threads */ ?>
<?php $title = $board['name']; ?>

<nav class="breadcrumb"><a href="/">Boards</a> › <?= e($board['name']) ?></nav>

<div class="page-head">
    <div>
        <h1><?= e($board['name']) ?></h1>
        <p class="muted"><?= e($board['description']) ?></p>
    </div>
    <?php if ($currentUser): ?>
        <a class="btn" href="/board/<?= (int) $board['id'] ?>/new">+ New thread</a>
    <?php else: ?>
        <a class="btn" href="/login">Log in to post</a>
    <?php endif; ?>
</div>

<?php if (empty($threads)): ?>
    <p class="empty">No threads yet. Be the first to start one!</p>
<?php else: ?>
    <table class="thread-table">
        <thead>
            <tr><th>Thread</th><th class="num">Replies</th><th>Started</th></tr>
        </thead>
        <tbody>
        <?php foreach ($threads as $thread): ?>
            <tr>
                <td>
                    <a class="thread-title" href="/thread/<?= (int) $thread['id'] ?>"><?= e($thread['title']) ?></a>
                    <div class="muted small">by <?= e($thread['author'] ?? '[deleted]') ?></div>
                </td>
                <td class="num"><?= (int) $thread['reply_count'] ?></td>
                <td class="muted small"><?= e(fmt_date($thread['created_at'])) ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
<?php endif; ?>
