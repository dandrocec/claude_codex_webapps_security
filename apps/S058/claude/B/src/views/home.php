<?php /** @var array $boards */ ?>
<h2>Boards</h2>
<p class="muted">Pick a board to read and start discussions.</p>

<?php foreach ($boards as $board): ?>
    <div class="card">
        <div class="post-head">
            <h2 style="font-size:1.1rem;">
                <a href="/board?id=<?= (int) $board['id'] ?>"><?= e($board['name']) ?></a>
            </h2>
            <span class="pill"><?= (int) $board['thread_count'] ?> threads</span>
        </div>
        <p class="muted"><?= e($board['description']) ?></p>
    </div>
<?php endforeach; ?>

<?php if (!$boards): ?>
    <div class="card muted">No boards yet.</div>
<?php endif; ?>
