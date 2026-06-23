<?php /** @var array $boards */ ?>
<?php $title = 'Boards'; ?>

<h1>Boards</h1>

<ul class="board-list">
    <?php foreach ($boards as $board): ?>
        <li class="board-item">
            <a class="board-name" href="/board/<?= (int) $board['id'] ?>"><?= e($board['name']) ?></a>
            <p class="board-desc"><?= e($board['description']) ?></p>
            <span class="muted"><?= (int) $board['thread_count'] ?> thread<?= $board['thread_count'] == 1 ? '' : 's' ?></span>
        </li>
    <?php endforeach; ?>
</ul>
