<?php
use PhotoBlog\Security;
?>
<section class="auth-panel">
  <h1>Log in</h1>
  <?php if (!empty($error)): ?><p class="error"><?= Security::e($error) ?></p><?php endif; ?>
  <form method="post" action="/login">
    <input type="hidden" name="csrf_token" value="<?= Security::e(Security::csrfToken()) ?>">
    <label>Username <input name="username" autocomplete="username" required minlength="3" maxlength="40"></label>
    <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit">Log in</button>
  </form>
</section>
