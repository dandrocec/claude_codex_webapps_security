<?php /** @var array $subscribers */ ?>
<section class="card">
    <h1>Subscribers <span class="count"><?= count($subscribers) ?></span></h1>

    <?php if (!$subscribers): ?>
        <p class="muted">No subscribers yet.</p>
    <?php else: ?>
        <table class="table">
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
</section>
