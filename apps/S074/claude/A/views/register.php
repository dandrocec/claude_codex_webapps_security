<?php
/** @var array $errors  @var string $name  @var string $email  @var string $role  @var string $shop_name */
$errors = $errors ?? [];
$role   = $role ?? 'buyer';
?>
<div class="panel narrow">
    <h1>Create an account</h1>

    <?php if ($errors): ?>
        <ul class="errlist">
            <?php foreach ($errors as $err): ?><li><?= e($err) ?></li><?php endforeach; ?>
        </ul>
    <?php endif; ?>

    <form method="post" action="/register">
        <?= csrf_field() ?>

        <label for="role">Account type</label>
        <select id="role" name="role" onchange="document.getElementById('shopRow').style.display = this.value==='vendor' ? 'block':'none';">
            <option value="buyer"  <?= $role === 'buyer'  ? 'selected' : '' ?>>Buyer — shop across all vendors</option>
            <option value="vendor" <?= $role === 'vendor' ? 'selected' : '' ?>>Vendor — sell your own products</option>
        </select>

        <label for="name">Your name</label>
        <input id="name" name="name" value="<?= e($name ?? '') ?>" required>

        <div id="shopRow" style="display:<?= $role === 'vendor' ? 'block' : 'none' ?>;">
            <label for="shop_name">Shop name</label>
            <input id="shop_name" name="shop_name" value="<?= e($shop_name ?? '') ?>">
        </div>

        <label for="email">Email</label>
        <input id="email" name="email" type="email" value="<?= e($email ?? '') ?>" required>

        <label for="password">Password</label>
        <input id="password" name="password" type="password" minlength="6" required>

        <div style="margin-top:18px;">
            <button class="btn" type="submit">Create account</button>
        </div>
    </form>
    <p class="muted" style="margin-top:14px;">Already have an account? <a href="/login">Log in</a>.</p>
</div>
