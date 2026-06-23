<?php
/** @var array $thread @var array $replies */
$user = current_user();
$canDelete = static function (int $authorId) use ($user): bool {
    return $user !== null && ((int) $user['id'] === $authorId || $user['role'] === 'moderator');
};
?>
<p class="crumbs">
    <a href="/">Boards</a> /
    <a href="/board?id=<?= (int) $thread['board_id'] ?>"><?= e($thread['board_name']) ?></a> /
    <?= e($thread['title']) ?>
</p>
<h2><?= e($thread['title']) ?></h2>

<div class="card">
    <div class="post-head">
        <span class="muted">by <?= e($thread['username']) ?> · <?= e($thread['created_at']) ?></span>
        <?php if ($canDelete((int) $thread['user_id'])): ?>
            <form method="post" action="/posts/delete" class="inline"
                  onsubmit="return confirm('Delete this thread and all its replies?');">
                <?= csrf_field() ?>
                <input type="hidden" name="type" value="thread">
                <input type="hidden" name="id" value="<?= (int) $thread['id'] ?>">
                <button type="submit" class="danger">Delete thread</button>
            </form>
        <?php endif; ?>
    </div>
    <div class="post-body"><?= e($thread['body']) ?></div>
</div>

<h2 style="font-size:1.1rem;">
    <?= count($replies) ?> repl<?= count($replies) === 1 ? 'y' : 'ies' ?>
</h2>

<?php foreach ($replies as $r): ?>
    <div class="card" id="reply-<?= (int) $r['id'] ?>">
        <div class="post-head">
            <span class="muted">by <?= e($r['username']) ?> · <?= e($r['created_at']) ?></span>
            <?php if ($canDelete((int) $r['user_id'])): ?>
                <form method="post" action="/posts/delete" class="inline"
                      onsubmit="return confirm('Delete this reply?');">
                    <?= csrf_field() ?>
                    <input type="hidden" name="type" value="reply">
                    <input type="hidden" name="id" value="<?= (int) $r['id'] ?>">
                    <button type="submit" class="danger">Delete</button>
                </form>
            <?php endif; ?>
        </div>
        <div class="post-body"><?= e($r['body']) ?></div>
    </div>
<?php endforeach; ?>

<?php if ($user): ?>
    <div class="card">
        <h2 style="font-size:1.05rem;">Post a reply</h2>
        <form method="post" action="/replies">
            <?= csrf_field() ?>
            <input type="hidden" name="thread_id" value="<?= (int) $thread['id'] ?>">
            <label for="body">Your reply</label>
            <textarea id="body" name="body" maxlength="10000" required></textarea>
            <div style="margin-top:10px;"><button type="submit">Reply</button></div>
        </form>
    </div>
<?php else: ?>
    <div class="card muted"><a href="/login">Log in</a> to reply.</div>
<?php endif; ?>
