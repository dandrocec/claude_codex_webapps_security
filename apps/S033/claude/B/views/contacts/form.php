<?php
/** @var string $mode */
/** @var string $action */
/** @var array<string,string> $errors */
/** @var array<string,mixed> $contact */
use App\Security;
?>
<section class="card form-card">
    <h1><?= $mode === 'edit' ? 'Edit contact' : 'Add contact' ?></h1>

    <form method="post" action="<?= $e($action) ?>" novalidate>
        <input type="hidden" name="csrf_token" value="<?= $e(Security::csrfToken()) ?>">
        <?php if ($mode === 'edit'): ?>
            <input type="hidden" name="id" value="<?= (int) ($contact['id'] ?? 0) ?>">
        <?php endif; ?>

        <div class="field">
            <label for="name">Name <span class="req">*</span></label>
            <input type="text" id="name" name="name" required maxlength="255"
                   value="<?= $e((string) ($contact['name'] ?? '')) ?>">
            <?php if (!empty($errors['name'])): ?>
                <p class="error"><?= $e($errors['name']) ?></p>
            <?php endif; ?>
        </div>

        <div class="field">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" maxlength="255"
                   value="<?= $e((string) ($contact['email'] ?? '')) ?>">
            <?php if (!empty($errors['email'])): ?>
                <p class="error"><?= $e($errors['email']) ?></p>
            <?php endif; ?>
        </div>

        <div class="field">
            <label for="phone">Phone</label>
            <input type="text" id="phone" name="phone" maxlength="64" inputmode="tel"
                   value="<?= $e((string) ($contact['phone'] ?? '')) ?>">
            <?php if (!empty($errors['phone'])): ?>
                <p class="error"><?= $e($errors['phone']) ?></p>
            <?php endif; ?>
        </div>

        <div class="field">
            <label for="address">Address</label>
            <textarea id="address" name="address" rows="3" maxlength="1000"><?= $e((string) ($contact['address'] ?? '')) ?></textarea>
            <?php if (!empty($errors['address'])): ?>
                <p class="error"><?= $e($errors['address']) ?></p>
            <?php endif; ?>
        </div>

        <div class="form-actions">
            <button type="submit" class="btn btn-primary"><?= $mode === 'edit' ? 'Save changes' : 'Add contact' ?></button>
            <a class="btn btn-ghost" href="/contacts">Cancel</a>
        </div>
    </form>
</section>
