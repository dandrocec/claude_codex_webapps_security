<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$submissions = storage()->all();
// Newest first for display.
$submissions = array_reverse($submissions);

layout_header('Submissions');
?>
<h1>Submissions</h1>
<p><?= count($submissions) ?> message<?= count($submissions) === 1 ? '' : 's' ?> received.</p>

<?php if (!$submissions): ?>
    <p>No submissions yet. <a href="index.php">Be the first to send one.</a></p>
<?php else: ?>
    <ul class="submissions">
        <?php foreach ($submissions as $s): ?>
            <li class="submission">
                <div class="meta">
                    <strong><?= e($s['name'] ?? '') ?></strong>
                    &lt;<?= e($s['email'] ?? '') ?>&gt;
                    <?php
                    // Render the stored UTC timestamp safely.
                    $ts = (string) ($s['timestamp'] ?? '');
                    $when = $ts !== '' ? date('Y-m-d H:i', strtotime($ts) ?: time()) : '';
                    ?>
                    <span class="when"><?= e($when) ?> UTC</span>
                </div>
                <p class="body"><?= nl2br(e($s['message'] ?? '')) ?></p>
            </li>
        <?php endforeach; ?>
    </ul>
<?php endif; ?>
<?php
layout_footer();
