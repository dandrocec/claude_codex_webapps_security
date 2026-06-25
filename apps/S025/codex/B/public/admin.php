<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/bootstrap.php';

$loginError = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    verify_csrf_token($_POST['csrf_token'] ?? null);
    $action = (string)($_POST['action'] ?? '');

    if ($action === 'login') {
        $username = trim((string)($_POST['username'] ?? ''));
        $password = (string)($_POST['password'] ?? '');

        if (authenticate_admin($username, $password)) {
            session_regenerate_id(true);
            $_SESSION['admin_id'] = 'admin';
            redirect('/admin.php');
        }

        password_hash($password, PASSWORD_ARGON2ID);
        $loginError = 'Invalid username or password.';
    } elseif ($action === 'logout') {
        unset($_SESSION['admin_id']);
        session_regenerate_id(true);
        redirect('/admin.php');
    } else {
        http_response_code(400);
        render_error_page('Invalid request.');
    }
}

if (!is_admin_authenticated()) {
    render_header('Admin sign in');
    ?>
    <main class="page">
        <section class="panel">
            <h1>Admin sign in</h1>

            <?php if ($loginError !== null): ?>
                <div class="notice error" role="alert"><?= e($loginError) ?></div>
            <?php endif; ?>

            <form method="post" action="/admin.php" novalidate>
                <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
                <input type="hidden" name="action" value="login">

                <label for="username">Username</label>
                <input id="username" name="username" autocomplete="username" maxlength="64" required>

                <label for="password">Password</label>
                <input id="password" name="password" type="password" autocomplete="current-password" required>

                <button type="submit">Sign in</button>
            </form>

            <p class="admin-link"><a href="/index.php">Back to subscription form</a></p>
        </section>
    </main>
    <?php
    render_footer();
    exit;
}

$subscribers = list_subscribers_for_admin('admin');

render_header('Subscribers');
?>
<main class="page wide">
    <section class="panel">
        <div class="topbar">
            <div>
                <h1>Subscribed addresses</h1>
                <p class="lede"><?= e((string)count($subscribers)) ?> total subscriptions.</p>
            </div>
            <form method="post" action="/admin.php" class="inline-form">
                <input type="hidden" name="csrf_token" value="<?= e(csrf_token()) ?>">
                <input type="hidden" name="action" value="logout">
                <button type="submit">Sign out</button>
            </form>
        </div>

        <?php if ($subscribers === []): ?>
            <p>No subscriptions yet.</p>
        <?php else: ?>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">Email</th>
                            <th scope="col">Subscribed</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($subscribers as $subscriber): ?>
                            <tr>
                                <td><?= e($subscriber['email']) ?></td>
                                <td><?= e(format_timestamp($subscriber['created_at'])) ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </section>
</main>
<?php render_footer(); ?>
