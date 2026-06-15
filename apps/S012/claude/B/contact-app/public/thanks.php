<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

// Only show the confirmation off the back of a real submission (PRG flow).
$justSubmitted = !empty($_SESSION['flash_success']);
unset($_SESSION['flash_success']);

layout_header('Thank you');
?>
<h1>Thank you!</h1>
<?php if ($justSubmitted): ?>
    <p>Your message has been received. We'll be in touch soon.</p>
<?php else: ?>
    <p>There's no submission to confirm. You can send us a message any time.</p>
<?php endif; ?>
<p><a href="index.php">Send another message</a></p>
<?php
layout_footer();
