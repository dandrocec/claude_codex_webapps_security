<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$errors = [];
$submittedEmail = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf_token($_POST['csrf_token'] ?? null);

    $email = normalize_email($_POST['email'] ?? '');
    if ($email === null) {
        $errors[] = 'Enter a valid email address.';
    } else {
        try {
            subscribe_email($email);
            $_SESSION['flash'] = 'Subscription confirmed for ' . $email . '.';
            redirect('/index.php');
        } catch (Throwable $exception) {
            error_log($exception->getMessage());
            $errors[] = 'We could not save your subscription. Please try again.';
        }
    }
}

$flash = $_SESSION['flash'] ?? null;
unset($_SESSION['flash']);

render_header('Subscribe');
?>
<main class="page">
    <section class="panel">
        <h1>Email subscription</h1>
        <p class="lede">Subscribe for updates with your email address.</p>

        <?php if ($flash !== null): ?>
            <div class="notice success" role="status"><?= e($flash) ?></div>
        <?php endif; ?>

        <?php if ($errors !== []): ?>
            <div class="notice error" role="alert">
                <?php foreach ($errors as $error): ?>
                    <p><?= e($error) ?></p>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <form method="post" action="/index.php" novalidate>
            <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
            <label for="email">Email address</label>
            <input
                id="email"
                name="email"
                type="email"
                inputmode="email"
                autocomplete="email"
                maxlength="254"
                required
                value="<?= e((string)($_POST['email'] ?? '')) ?>"
            >
            <button type="submit">Subscribe</button>
        </form>

        <p class="admin-link"><a href="/admin.php">Subscriber list</a></p>
    </section>
</main>
<?php render_footer(); ?>
