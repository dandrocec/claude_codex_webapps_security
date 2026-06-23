<?php /** @var array $thread */ ?>
<?php /** @var array $replies */ ?>
<?php $title = $thread['title']; ?>

<nav class="breadcrumb">
    <a href="/">Boards</a> ›
    <a href="/board/<?= (int) $thread['board_id'] ?>"><?= e($thread['board_name']) ?></a> ›
    <?= e($thread['title']) ?>
</nav>

<article class="post op">
    <div class="post-head">
        <h1><?= e($thread['title']) ?></h1>
        <?php if ($currentUser && (App\Auth::isModerator() || (int) $currentUser['id'] === (int) $thread['user_id'])): ?>
            <form method="post" action="/thread/<?= (int) $thread['id'] ?>/delete" class="inline"
                  onsubmit="return confirm('Delete this thread and all its replies?');">
                <?= csrf_field() ?>
                <button type="submit" class="btn btn-danger btn-small">Delete thread</button>
            </form>
        <?php endif; ?>
    </div>
    <div class="post-meta muted small">
        by <?= e($thread['author'] ?? '[deleted]') ?> · <?= e(fmt_date($thread['created_at'])) ?>
    </div>
    <div class="post-body"><?= nl2br(e($thread['body'])) ?></div>
</article>

<h2 id="replies"><?= count($replies) ?> repl<?= count($replies) === 1 ? 'y' : 'ies' ?></h2>

<?php foreach ($replies as $reply): ?>
    <article class="post reply">
        <div class="post-head">
            <div class="post-meta muted small">
                <?= e($reply['author'] ?? '[deleted]') ?> · <?= e(fmt_date($reply['created_at'])) ?>
            </div>
            <?php if ($currentUser && (App\Auth::isModerator() || (int) $currentUser['id'] === (int) $reply['user_id'])): ?>
                <form method="post" action="/reply/<?= (int) $reply['id'] ?>/delete" class="inline"
                      onsubmit="return confirm('Delete this reply?');">
                    <?= csrf_field() ?>
                    <button type="submit" class="btn btn-danger btn-small">Delete</button>
                </form>
            <?php endif; ?>
        </div>
        <div class="post-body"><?= nl2br(e($reply['body'])) ?></div>
    </article>
<?php endforeach; ?>

<?php if ($currentUser): ?>
    <form method="post" action="/thread/<?= (int) $thread['id'] ?>/reply" class="reply-form">
        <?= csrf_field() ?>
        <h3>Post a reply</h3>
        <textarea name="body" rows="4" placeholder="Write your reply…" required></textarea>
        <button type="submit" class="btn">Reply</button>
    </form>
<?php else: ?>
    <p class="empty"><a href="/login">Log in</a> to post a reply.</p>
<?php endif; ?>
