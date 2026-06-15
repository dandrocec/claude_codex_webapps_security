<?php
/**
 * Subscription form. Handles POST submissions (store email + confirm)
 * and renders the form on GET.
 */

declare(strict_types=1);

require __DIR__ . '/../src/db.php';
require __DIR__ . '/../src/layout.php';

$message = null;
$status  = null;
$email   = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim((string) ($_POST['email'] ?? ''));

    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $status  = 'error';
        $message = 'Please enter a valid email address.';
    } else {
        try {
            $stmt = get_db()->prepare('INSERT INTO subscribers (email) VALUES (:email)');
            $stmt->execute([':email' => $email]);
            $status  = 'success';
            $message = 'Thanks! ' . $email . ' is now subscribed.';
            $email   = ''; // clear the field after success
        } catch (PDOException $ex) {
            // SQLite throws on the UNIQUE constraint for a duplicate email.
            if ($ex->getCode() === '23000') {
                $status  = 'success';
                $message = 'You are already subscribed — thanks for sticking with us!';
                $email   = '';
            } else {
                $status  = 'error';
                $message = 'Something went wrong. Please try again.';
            }
        }
    }
}

render_header('Subscribe');
?>
    <h1>Join the mailing list</h1>
    <p class="muted">Enter your email to subscribe to updates.</p>

<?php if ($message !== null): ?>
    <div class="flash <?= e($status) ?>"><?= e($message) ?></div>
<?php endif; ?>

    <form method="post" action="/">
        <input
            type="email"
            name="email"
            placeholder="you@example.com"
            value="<?= e($email) ?>"
            required
            autofocus
        >
        <button type="submit">Subscribe</button>
    </form>
<?php
render_footer();
