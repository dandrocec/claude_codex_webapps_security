<?php
use PhotoBlog\Security;
?>
<section class="auth-panel">
  <h1>Request failed</h1>
  <p class="error"><?= Security::e($message ?? 'Something went wrong.') ?></p>
  <p><a href="/">Return to feed</a></p>
</section>
