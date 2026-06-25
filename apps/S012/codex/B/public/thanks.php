<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

render_header('Thank you');
?>
<main class="shell">
  <section class="panel">
    <h1>Thank you</h1>
    <p>Your message has been received.</p>
    <p><a href="/">Send another message</a></p>
  </section>
</main>
<?php render_footer(); ?>
