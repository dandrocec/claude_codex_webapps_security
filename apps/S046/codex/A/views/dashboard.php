<section class="page-heading">
    <div>
        <h1>Dashboard</h1>
        <p><?= $currentUser['is_admin'] ? 'Review and manage submitted quotes.' : 'Manage your submitted quotes.' ?></p>
    </div>
    <a class="button" href="/quotes/new">Submit a quote</a>
</section>

<?php if (!$quotes): ?>
    <div class="empty">No quotes yet.</div>
<?php endif; ?>

<div class="table-wrap">
    <table>
        <thead>
            <tr>
                <th>Quote</th>
                <th>Author</th>
                <?php if ($currentUser['is_admin']): ?>
                    <th>Submitter</th>
                <?php endif; ?>
                <th>Status</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            <?php foreach ($quotes as $quote): ?>
                <tr>
                    <td><?= e(excerpt($quote['quote_text'])) ?></td>
                    <td><?= e($quote['author']) ?></td>
                    <?php if ($currentUser['is_admin']): ?>
                        <td><?= e($quote['submitter']) ?></td>
                    <?php endif; ?>
                    <td>
                        <span class="status <?= $quote['approved'] ? 'approved' : 'pending' ?>">
                            <?= $quote['approved'] ? 'Approved' : 'Pending' ?>
                        </span>
                    </td>
                    <td class="actions">
                        <a href="/quotes/<?= (int) $quote['id'] ?>/edit">Edit</a>
                        <?php if ($currentUser['is_admin']): ?>
                            <form method="post" action="/quotes/<?= (int) $quote['id'] ?>/approve">
                                <button type="submit"><?= $quote['approved'] ? 'Unapprove' : 'Approve' ?></button>
                            </form>
                            <form method="post" action="/quotes/<?= (int) $quote['id'] ?>/delete">
                                <button class="danger" type="submit">Delete</button>
                            </form>
                        <?php endif; ?>
                    </td>
                </tr>
            <?php endforeach; ?>
        </tbody>
    </table>
</div>
