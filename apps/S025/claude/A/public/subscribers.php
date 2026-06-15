<?php
/**
 * Lists every subscribed email address, newest first.
 */

declare(strict_types=1);

require __DIR__ . '/../src/db.php';
require __DIR__ . '/../src/layout.php';

$subscribers = get_db()
    ->query('SELECT email, created_at FROM subscribers ORDER BY id DESC')
    ->fetchAll();

render_header('Subscribers');
?>
    <h1>Subscribers</h1>
    <p class="muted"><?= count($subscribers) ?> subscribed address<?= count($subscribers) === 1 ? '' : 'es' ?>.</p>

<?php if (empty($subscribers)): ?>
    <p>No subscribers yet. <a href="/">Be the first to subscribe.</a></p>
<?php else: ?>
    <table>
        <thead>
            <tr><th>Email</th><th>Subscribed at (UTC)</th></tr>
        </thead>
        <tbody>
        <?php foreach ($subscribers as $row): ?>
            <tr>
                <td><?= e($row['email']) ?></td>
                <td><?= e($row['created_at']) ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
<?php endif; ?>
<?php
render_footer();
