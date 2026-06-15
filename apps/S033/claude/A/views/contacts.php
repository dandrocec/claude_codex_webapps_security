<?php /** @var array $contacts @var string $search */ ?>
<div class="page-head">
    <h1>My contacts</h1>
    <a class="btn primary" href="/contacts/add">+ Add contact</a>
</div>

<form method="get" action="/contacts" class="searchbar">
    <input type="search" name="q" value="<?= e($search) ?>" placeholder="Search by name…" autofocus>
    <button type="submit" class="btn">Search</button>
    <?php if ($search !== ''): ?>
        <a class="btn ghost" href="/contacts">Clear</a>
    <?php endif; ?>
</form>

<?php if (!$contacts): ?>
    <p class="empty">
        <?= $search !== '' ? 'No contacts match “' . e($search) . '”.' : 'No contacts yet. Add your first one!' ?>
    </p>
<?php else: ?>
    <table class="contacts">
        <thead>
            <tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th></th></tr>
        </thead>
        <tbody>
        <?php foreach ($contacts as $c): ?>
            <tr>
                <td data-label="Name"><?= e($c['name']) ?></td>
                <td data-label="Email">
                    <?php if ($c['email'] !== ''): ?>
                        <a href="mailto:<?= e($c['email']) ?>"><?= e($c['email']) ?></a>
                    <?php endif; ?>
                </td>
                <td data-label="Phone"><?= e($c['phone']) ?></td>
                <td data-label="Address"><?= e($c['address']) ?></td>
                <td class="actions">
                    <a class="btn small" href="/contacts/edit?id=<?= (int)$c['id'] ?>">Edit</a>
                    <form method="post" action="/contacts/delete" class="inline"
                          onsubmit="return confirm('Delete <?= e(addslashes($c['name'])) ?>?');">
                        <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
                        <input type="hidden" name="id" value="<?= (int)$c['id'] ?>">
                        <button type="submit" class="btn small danger">Delete</button>
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
<?php endif; ?>
