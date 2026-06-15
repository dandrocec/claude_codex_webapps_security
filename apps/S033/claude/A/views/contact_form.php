<?php /** @var array $contact @var array $errors @var string $action */ ?>
<div class="page-head">
    <h1><?= $contact['id'] ? 'Edit contact' : 'Add contact' ?></h1>
    <a class="btn ghost" href="/contacts">Back</a>
</div>

<?php require __DIR__ . '/_errors.php'; ?>

<form method="post" action="<?= e($action) ?>" class="card form">
    <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">
    <?php if ($contact['id']): ?>
        <input type="hidden" name="id" value="<?= (int)$contact['id'] ?>">
    <?php endif; ?>

    <label>Name <span class="req">*</span>
        <input type="text" name="name" value="<?= e($contact['name']) ?>" required maxlength="120">
    </label>
    <label>Email
        <input type="email" name="email" value="<?= e($contact['email']) ?>" maxlength="190">
    </label>
    <label>Phone
        <input type="text" name="phone" value="<?= e($contact['phone']) ?>" maxlength="60">
    </label>
    <label>Address
        <textarea name="address" rows="3" maxlength="500"><?= e($contact['address']) ?></textarea>
    </label>

    <div class="form-actions">
        <button type="submit" class="btn primary">Save</button>
        <a class="btn ghost" href="/contacts">Cancel</a>
    </div>
</form>
