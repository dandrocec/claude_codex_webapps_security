<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

$csrf = csrf_token();
render_header('Contact');
?>
<main class="shell">
  <h1>Contact us</h1>
  <form method="post" action="/submit.php" class="panel" novalidate>
    <input type="hidden" name="csrf_token" value="<?= e($csrf) ?>">

    <label for="name">Name</label>
    <input id="name" name="name" type="text" maxlength="120" required autocomplete="name">

    <label for="email">Email</label>
    <input id="email" name="email" type="email" maxlength="254" required autocomplete="email">

    <label for="message">Message</label>
    <textarea id="message" name="message" maxlength="4000" required></textarea>

    <button type="submit">Send message</button>
  </form>
</main>
<?php render_footer(); ?>
