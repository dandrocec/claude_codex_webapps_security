<?php
/** @var string $heading */
/** @var string $message */
?>
<section class="card error-card">
    <h1><?= $e($heading ?? 'Error') ?></h1>
    <p><?= $e($message ?? 'Something went wrong.') ?></p>
    <p><a class="btn" href="/contacts">Back to contacts</a></p>
</section>
