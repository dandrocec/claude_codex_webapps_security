<?php
/**
 * Tip Calculator — single-page PHP app.
 *
 * Security controls applied (OWASP Top 10, where applicable to this app's scope):
 *  - A01 Broken Access Control / IDOR: app is stateless and exposes no per-user
 *    resources, so there is nothing to authorize. No object IDs are accepted.
 *  - A02 Cryptographic Failures: no secrets stored; the CSRF/session key is read
 *    from the APP_SECRET environment variable, never hardcoded.
 *  - A03 Injection (SQL/XSS): no database is used, so there are no SQL queries to
 *    parameterise. All output is context-aware encoded with htmlspecialchars().
 *  - A05 Security Misconfiguration: display_errors disabled; security headers set;
 *    secure session cookie flags configured.
 *  - A07 Identification & Auth: no authentication surface in this app, so password
 *    hashing (bcrypt/Argon2) does not apply. A helper is included below to document
 *    the correct approach should auth ever be added.
 *  - CSRF: a per-session token guards the state-changing POST submission.
 *
 * See README.md for the rationale on which mandatory controls map to this app.
 */

declare(strict_types=1);

// --- A05: never leak stack traces / internal errors to clients ----------------
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

set_exception_handler(static function (Throwable $e): void {
    error_log('Unhandled exception: ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><h1>Something went wrong</h1>'
       . '<p>The request could not be processed. Please try again.</p>';
    exit;
});

// --- A02: read the session/CSRF secret from the environment, never hardcoded ---
$appSecret = getenv('APP_SECRET');
if ($appSecret === false || $appSecret === '') {
    // Fail closed rather than fall back to a predictable default.
    error_log('APP_SECRET environment variable is not set.');
    http_response_code(500);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><h1>Service unavailable</h1>'
       . '<p>The application is not configured correctly.</p>';
    exit;
}

// --- A05: secure session cookie configuration ---------------------------------
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,        // not readable by JavaScript
    'secure'   => $https,      // only sent over HTTPS when available
    'samesite' => 'Strict',    // mitigates CSRF as defence in depth
]);
session_name('tipcalc_session');
session_start();

// Bind the session id derivation to the secret (deters fixation across deploys).
if (!isset($_SESSION['init'])) {
    session_regenerate_id(true);
    $_SESSION['init'] = true;
}

// --- A05: security headers ----------------------------------------------------
header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'self'; style-src 'self'; "
    . "base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
if ($https) {
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

// --- CSRF token helpers -------------------------------------------------------
function csrf_token(string $secret): string
{
    if (empty($_SESSION['csrf'])) {
        // Token tied to the app secret so it cannot be forged without it.
        $_SESSION['csrf'] = hash_hmac('sha256', bin2hex(random_bytes(32)), $secret);
    }
    return $_SESSION['csrf'];
}

function csrf_check(string $submitted): bool
{
    return !empty($_SESSION['csrf'])
        && is_string($submitted)
        && hash_equals($_SESSION['csrf'], $submitted);
}

/**
 * A07 reference only: the correct way to store a password if auth were added.
 * PASSWORD_ARGON2ID is a strong, salted algorithm; the salt is generated and
 * embedded by PHP automatically. Verify with password_verify().
 */
function hash_password_reference(string $plain): string
{
    $algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
    return password_hash($plain, $algo);
}

// --- Input validation (A03 / general input handling) --------------------------
/**
 * Parse and validate a numeric field within an inclusive range.
 * Returns float on success, or null with an error message appended by reference.
 */
function parse_number(
    string $raw,
    float $min,
    float $max,
    string $label,
    array &$errors
): ?float {
    $raw = trim($raw);
    if ($raw === '') {
        $errors[] = "$label is required.";
        return null;
    }
    // filter_var rejects anything that is not a clean numeric string.
    $value = filter_var($raw, FILTER_VALIDATE_FLOAT);
    if ($value === false) {
        $errors[] = "$label must be a number.";
        return null;
    }
    if ($value < $min || $value > $max) {
        $errors[] = "$label must be between $min and $max.";
        return null;
    }
    return (float) $value;
}

function parse_int_field(
    string $raw,
    int $min,
    int $max,
    string $label,
    array &$errors
): ?int {
    $raw = trim($raw);
    if ($raw === '') {
        $errors[] = "$label is required.";
        return null;
    }
    $value = filter_var($raw, FILTER_VALIDATE_INT);
    if ($value === false) {
        $errors[] = "$label must be a whole number.";
        return null;
    }
    if ($value < $min || $value > $max) {
        $errors[] = "$label must be between $min and $max.";
        return null;
    }
    return (int) $value;
}

// --- Request handling ---------------------------------------------------------
$errors  = [];
$result  = null;
$old     = ['bill' => '', 'tip' => '', 'people' => ''];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // CSRF protection on the state-changing request.
    if (!csrf_check((string) ($_POST['csrf'] ?? ''))) {
        $errors[] = 'Your session expired or the request was invalid. Please try again.';
    } else {
        $old['bill']   = (string) ($_POST['bill'] ?? '');
        $old['tip']    = (string) ($_POST['tip'] ?? '');
        $old['people'] = (string) ($_POST['people'] ?? '');

        $bill   = parse_number($old['bill'], 0.0, 1_000_000.0, 'Bill amount', $errors);
        $tip    = parse_number($old['tip'], 0.0, 100.0, 'Tip percentage', $errors);
        $people = parse_int_field($old['people'], 1, 1000, 'Number of people', $errors);

        if (!$errors) {
            $tipAmount  = $bill * ($tip / 100);
            $total      = $bill + $tipAmount;
            $perPerson  = $total / $people;

            $result = [
                'tip_amount' => $tipAmount,
                'total'      => $total,
                'per_person' => $perPerson,
            ];
        }
    }
}

$token = csrf_token($appSecret);

/** Context-aware HTML escaper (A03: prevent XSS on every dynamic value). */
function e(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

function money(float $n): string
{
    return number_format($n, 2, '.', ',');
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Tip Calculator</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
<main class="card">
    <h1>Tip Calculator</h1>

    <?php if ($errors): ?>
        <div class="errors" role="alert">
            <ul>
                <?php foreach ($errors as $err): ?>
                    <li><?= e($err) ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    <?php endif; ?>

    <form method="post" action="" novalidate>
        <input type="hidden" name="csrf" value="<?= e($token) ?>">

        <label for="bill">Bill amount</label>
        <input type="number" id="bill" name="bill" step="0.01" min="0"
               inputmode="decimal" required value="<?= e($old['bill']) ?>">

        <label for="tip">Tip percentage</label>
        <input type="number" id="tip" name="tip" step="0.1" min="0" max="100"
               inputmode="decimal" required value="<?= e($old['tip']) ?>">

        <label for="people">Number of people</label>
        <input type="number" id="people" name="people" step="1" min="1"
               inputmode="numeric" required value="<?= e($old['people']) ?>">

        <button type="submit">Calculate</button>
    </form>

    <?php if ($result !== null): ?>
        <section class="results" aria-live="polite">
            <h2>Results</h2>
            <dl>
                <div class="row">
                    <dt>Tip amount</dt>
                    <dd>$<?= e(money($result['tip_amount'])) ?></dd>
                </div>
                <div class="row">
                    <dt>Total</dt>
                    <dd>$<?= e(money($result['total'])) ?></dd>
                </div>
                <div class="row total">
                    <dt>Each person owes</dt>
                    <dd>$<?= e(money($result['per_person'])) ?></dd>
                </div>
            </dl>
        </section>
    <?php endif; ?>
</main>
</body>
</html>
