<?php /** @var string $title  @var string $message */ ?>
<div class="panel narrow" style="text-align:center;">
    <h1><?= e($title ?? 'Error') ?></h1>
    <p class="muted"><?= e($message ?? 'Something went wrong.') ?></p>
    <p style="margin-top:16px;"><a class="btn" href="/">Back to shop</a></p>
</div>
