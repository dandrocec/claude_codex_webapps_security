<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

/** Remove control characters; keep newlines only when $allowNewlines. */
function clean_text(string $value, bool $allowNewlines = false): string
{
    $value = trim($value);
    $pattern = $allowNewlines
        ? '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u'   // keep \n (0A) and \r (0D)
        : '/[\x00-\x1F\x7F]/u';                    // strip all control chars
    return (string) preg_replace($pattern, '', $value);
}

$errors = [];
$old = ['name' => '', 'email' => '', 'message' => ''];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // State-changing request -> verify CSRF token first.
    csrf_check();

    $name    = clean_text((string) ($_POST['name'] ?? ''));
    $email   = clean_text((string) ($_POST['email'] ?? ''));
    $message = clean_text((string) ($_POST['message'] ?? ''), true);
    $old = ['name' => $name, 'email' => $email, 'message' => $message];

    // --- Validation (OWASP A03: validate + sanitise all input) ------------
    if ($name === '') {
        $errors['name'] = 'Please enter your name.';
    } elseif (mb_strlen($name) > 100) {
        $errors['name'] = 'Name must be 100 characters or fewer.';
    }

    if ($email === '') {
        $errors['email'] = 'Please enter your email address.';
    } elseif (mb_strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        $errors['email'] = 'Please enter a valid email address.';
    }

    if ($message === '') {
        $errors['message'] = 'Please enter a message.';
    } elseif (mb_strlen($message) > 5000) {
        $errors['message'] = 'Message must be 5000 characters or fewer.';
    }

    if (!$errors) {
        storage()->append($old);
        // Post/Redirect/Get: avoids duplicate submissions on refresh.
        $_SESSION['flash_success'] = true;
        header('Location: thanks.php', true, 303);
        exit;
    }
}

layout_header('Contact us');
?>
<h1>Contact us</h1>
<p>Fill in the form below and we'll get back to you.</p>

<?php if ($errors): ?>
    <div class="alert error" role="alert">
        <p>Please fix the following:</p>
        <ul>
            <?php foreach ($errors as $message): ?>
                <li><?= e($message) ?></li>
            <?php endforeach; ?>
        </ul>
    </div>
<?php endif; ?>

<form method="post" action="index.php" novalidate>
    <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">

    <label for="name">Name</label>
    <input type="text" id="name" name="name" maxlength="100" required
           value="<?= e($old['name']) ?>"
           <?= isset($errors['name']) ? 'aria-invalid="true"' : '' ?>>

    <label for="email">Email</label>
    <input type="email" id="email" name="email" maxlength="254" required
           value="<?= e($old['email']) ?>"
           <?= isset($errors['email']) ? 'aria-invalid="true"' : '' ?>>

    <label for="message">Message</label>
    <textarea id="message" name="message" rows="6" maxlength="5000" required
              <?= isset($errors['message']) ? 'aria-invalid="true"' : '' ?>><?= e($old['message']) ?></textarea>

    <button type="submit">Send message</button>
</form>
<?php
layout_footer();
