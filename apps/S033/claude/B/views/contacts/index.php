<?php
/** @var array<int, array<string,mixed>> $contacts */
/** @var string $search */
use App\Security;
?>
<div class="page-head">
    <h1>My Contacts</h1>
    <a class="btn btn-primary" href="/contacts/new">+ Add contact</a>
</div>

<form method="get" action="/contacts" class="search-form" role="search">
    <input type="search" name="q" placeholder="Search by name…"
           value="<?= $e($search) ?>" maxlength="255" aria-label="Search by name">
    <button type="submit" class="btn">Search</button>
    <?php if ($search !== ''): ?>
        <a class="btn btn-ghost" href="/contacts">Clear</a>
    <?php endif; ?>
</form>

<?php if ($contacts === []): ?>
    <p class="empty">
        <?= $search !== ''
            ? 'No contacts match "' . $e($search) . '".'
            : 'You have no contacts yet. Add your first one!' ?>
    </p>
<?php else: ?>
    <div class="table-wrap">
        <table class="contacts">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Address</th>
                    <th class="actions-col">Actions</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($contacts as $c): ?>
                <tr>
                    <td data-label="Name"><?= $e((string) $c['name']) ?></td>
                    <td data-label="Email">
                        <?php if ((string) $c['email'] !== ''): ?>
                            <a href="mailto:<?= $e((string) $c['email']) ?>"><?= $e((string) $c['email']) ?></a>
                        <?php else: ?>
                            <span class="muted">—</span>
                        <?php endif; ?>
                    </td>
                    <td data-label="Phone"><?= (string) $c['phone'] !== '' ? $e((string) $c['phone']) : '<span class="muted">—</span>' ?></td>
                    <td data-label="Address"><?= (string) $c['address'] !== '' ? nl2br($e((string) $c['address'])) : '<span class="muted">—</span>' ?></td>
                    <td data-label="Actions" class="row-actions">
                        <a class="btn btn-small" href="/contacts/edit?id=<?= (int) $c['id'] ?>">Edit</a>
                        <form method="post" action="/contacts/delete" class="inline-form"
                              data-confirm="Delete this contact?">
                            <input type="hidden" name="csrf_token" value="<?= $e(Security::csrfToken()) ?>">
                            <input type="hidden" name="id" value="<?= (int) $c['id'] ?>">
                            <button type="submit" class="btn btn-small btn-danger">Delete</button>
                        </form>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
<?php endif; ?>

<script src="/assets/app.js"></script>
