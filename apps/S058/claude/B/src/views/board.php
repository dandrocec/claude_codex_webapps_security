<?php /** @var array $board @var array $threads */ ?>
<p class="crumbs"><a href="/">Boards</a> / <?= e($board['name']) ?></p>
<h2><?= e($board['name']) ?></h2>
<p class="muted"><?= e($board['description']) ?></p>

<?php if (current_user()): ?>
    <div class="card">
        <h2 style="font-size:1.05rem;">Start a new thread</h2>
        <form method="post" action="/threads">
            <?= csrf_field() ?>
            <input type="hidden" name="board_id" value="<?= (int) $board['id'] ?>">
            <label for="title">Title</label>
            <input type="text" id="title" name="title" maxlength="200" required>
            <label for="body">Message</label>
            <textarea id="body" name="body" maxlength="10000" required></textarea>
            <div style="margin-top:10px;"><button type="submit">Create thread</button></div>
        </form>
    </div>
<?php else: ?>
    <div class="card muted"><a href="/login">Log in</a> to start a thread.</div>
<?php endif; ?>

<h2 style="font-size:1.1rem; margin-top:20px;">Threads</h2>
<div class="card">
    <?php if (!$threads): ?>
        <p class="muted">No threads yet — be the first to post.</p>
    <?php endif; ?>
    <?php foreach ($threads as $t): ?>
        <div class="thread-row">
            <div>
                <a href="/thread?id=<?= (int) $t['id'] ?>"><?= e($t['title']) ?></a>
                <div class="muted">by <?= e($t['username']) ?> · <?= e($t['created_at']) ?></div>
            </div>
            <span class="pill"><?= (int) $t['reply_count'] ?> repl<?= (int) $t['reply_count'] === 1 ? 'y' : 'ies' ?></span>
        </div>
    <?php endforeach; ?>
</div>
