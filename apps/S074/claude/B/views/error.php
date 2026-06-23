<?php
/** @var int $status */
/** @var string $message */
use function App\e;
?>
<h1>Error <?= (int) $status ?></h1>
<p class="muted"><?= e($message) ?></p>
<p><a class="btn btn-ghost" href="/">Back to the shop</a></p>
