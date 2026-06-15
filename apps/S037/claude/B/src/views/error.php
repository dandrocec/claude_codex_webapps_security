<?php
/** @var int $code */
/** @var string $title */
/** @var string $message */
namespace App;
?>
<h1><?= (int) $code ?> — <?= e($title) ?></h1>
<?php if (!empty($message)): ?>
    <p><?= e($message) ?></p>
<?php endif; ?>
<p><a href="/">Return to the gallery</a></p>
