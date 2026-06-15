<?php
declare(strict_types=1);

/**
 * Front controller for the poll application.
 *
 * Routes:
 *   GET  /  -> show the poll (or results if the visitor already voted)
 *   POST /  -> validate CSRF + input, record the vote, redirect (PRG pattern)
 */

use Poll\Security;
use Poll\VoteStore;

require __DIR__ . '/../src/Security.php';
require __DIR__ . '/../src/VoteStore.php';

$config = require __DIR__ . '/../config/config.php';

/* ---------------------------------------------------------------------------
 * Error handling: never leak stack traces or internal details to the client.
 * ------------------------------------------------------------------------- */
$isDev = ($config['app_env'] === 'development');
error_reporting(E_ALL);
ini_set('display_errors', $isDev ? '1' : '0');
ini_set('log_errors', '1');

$failClosed = static function (int $status, string $publicMessage): void {
    http_response_code($status);
    header('Content-Type: text/html; charset=UTF-8');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<title>Error</title></head><body><h1>Something went wrong</h1><p>'
        . htmlspecialchars($publicMessage, ENT_QUOTES, 'UTF-8')
        . '</p></body></html>';
    exit;
};

set_exception_handler(static function (\Throwable $e) use ($isDev, $failClosed): void {
    error_log('[poll] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $failClosed(500, $isDev ? $e->getMessage() : 'An unexpected error occurred. Please try again later.');
});

set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    throw new \ErrorException($message, 0, $severity, $file, $line);
});

/* ---------------------------------------------------------------------------
 * Session + security headers.
 * ------------------------------------------------------------------------- */
Security::startSession((bool) $config['cookie_secure']);
Security::sendSecurityHeaders();

$poll    = $config['poll'];
$options = $poll['options'];
$store   = new VoteStore((string) $config['storage_file'], $options);

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$flash  = null;

/* ---------------------------------------------------------------------------
 * Handle vote submission.
 * ------------------------------------------------------------------------- */
if ($method === 'POST') {
    // CSRF protection on every state-changing request.
    if (!Security::checkCsrf($_POST['csrf_token'] ?? null)) {
        $failClosed(400, 'Invalid or missing security token. Please reload the page and try again.');
    }

    // Access control: a visitor may only cast one vote (their own resource).
    // Prevents ballot stuffing and tampering with others' votes (IDOR class).
    if (!empty($_SESSION['has_voted'])) {
        header('Location: /?already=1', true, 303);
        exit;
    }

    // Validate + sanitise input against the server-side whitelist.
    $choice = isset($_POST['option']) && is_string($_POST['option']) ? $_POST['option'] : '';
    if (!array_key_exists($choice, $options)) {
        $failClosed(422, 'Please choose one of the available options.');
    }

    $store->record($choice);

    // Mark this session as having voted (server-side, not client-controlled).
    $_SESSION['has_voted']  = true;
    $_SESSION['my_choice']  = $choice;

    // Post/Redirect/Get to avoid duplicate submissions on refresh.
    header('Location: /?voted=1', true, 303);
    exit;
}

/* ---------------------------------------------------------------------------
 * Render.
 * ------------------------------------------------------------------------- */
$tally     = $store->tally();
$total     = array_sum($tally);
$hasVoted  = !empty($_SESSION['has_voted']);
$myChoice  = $_SESSION['my_choice'] ?? null;
$csrfToken = Security::csrfToken();

if (isset($_GET['voted'])) {
    $flash = 'Thanks — your vote has been recorded.';
} elseif (isset($_GET['already'])) {
    $flash = 'You have already voted in this poll.';
}

header('Content-Type: text/html; charset=UTF-8');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= Security::e($poll['question']) ?></title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
<main class="card">
    <h1><?= Security::e($poll['question']) ?></h1>

    <?php if ($flash !== null): ?>
        <p class="flash" role="status"><?= Security::e($flash) ?></p>
    <?php endif; ?>

    <?php if (!$hasVoted): ?>
        <form method="post" action="/" class="vote-form">
            <input type="hidden" name="csrf_token" value="<?= Security::e($csrfToken) ?>">
            <fieldset>
                <legend>Choose one option</legend>
                <?php foreach ($options as $key => $label): ?>
                    <label class="option">
                        <input type="radio" name="option" value="<?= Security::e($key) ?>" required>
                        <span><?= Security::e($label) ?></span>
                    </label>
                <?php endforeach; ?>
            </fieldset>
            <button type="submit">Vote</button>
        </form>
    <?php endif; ?>

    <section class="results" aria-label="Current results">
        <h2>Current results</h2>
        <ul>
            <?php foreach ($options as $key => $label): ?>
                <?php
                    $count   = $tally[$key] ?? 0;
                    $percent = $total > 0 ? (int) round(($count / $total) * 100) : 0;
                    // Round to the nearest 5% so the bar width maps to a
                    // predefined CSS class — keeps a strict CSP with no inline styles.
                    $widthStep = (int) (round($percent / 5) * 5);
                    $isMine  = ($key === $myChoice);
                ?>
                <li class="<?= $isMine ? 'mine' : '' ?>">
                    <div class="result-head">
                        <span class="result-label">
                            <?= Security::e($label) ?><?= $isMine ? ' (your vote)' : '' ?>
                        </span>
                        <span class="result-count"><?= (int) $count ?> · <?= (int) $percent ?>%</span>
                    </div>
                    <div class="bar" aria-hidden="true">
                        <div class="bar-fill w<?= $widthStep ?>"></div>
                    </div>
                </li>
            <?php endforeach; ?>
        </ul>
        <p class="total">Total votes: <?= (int) $total ?></p>
    </section>
</main>
</body>
</html>
