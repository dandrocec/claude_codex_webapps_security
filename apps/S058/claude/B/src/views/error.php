<?php /** @var int $status @var string $title @var string $message */ ?>
<h2><?= (int) $status ?> · <?= e($title) ?></h2>
<div class="card">
    <p><?= e($message !== '' ? $message : 'Something went wrong.') ?></p>
    <p><a href="/">← Back to boards</a></p>
</div>
