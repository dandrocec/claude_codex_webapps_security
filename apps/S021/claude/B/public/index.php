<?php

declare(strict_types=1);

/**
 * Base64 encode/decode tool.
 *
 * Single front controller. Stateless tool (no database, no user accounts),
 * so several OWASP controls (SQLi, password hashing, IDOR/access control)
 * are not applicable here. The controls that DO apply are implemented:
 *  - CSRF protection on the state-changing POST
 *  - Context-aware output encoding (XSS)
 *  - Input validation / size limits
 *  - Secure session cookies (HttpOnly, Secure, SameSite)
 *  - Security headers (CSP, X-Content-Type-Options, etc.)
 *  - No internal error / stack-trace leakage to clients
 *  - Secrets read from the environment, never hardcoded
 */

require __DIR__ . '/../src/bootstrap.php';

use App\Csrf;
use App\Base64Service;

start_secure_session();
send_security_headers();

$result   = null;   // computed output (string) on success
$error    = null;   // user-facing error message (safe, generic)
$text     = '';     // sticky form value
$direction = 'encode';

// Maximum accepted input size (defence against resource-exhaustion).
const MAX_INPUT_BYTES = 100_000;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        // --- CSRF check (state-changing request) ---
        $token = (string) ($_POST['csrf_token'] ?? '');
        if (!Csrf::validate($token)) {
            http_response_code(400);
            $error = 'Invalid or expired form token. Please try again.';
        } else {
            // --- Input validation ---
            $text = (string) ($_POST['text'] ?? '');
            $direction = (string) ($_POST['direction'] ?? '');

            if (!in_array($direction, ['encode', 'decode'], true)) {
                $error = 'Please choose a valid direction.';
            } elseif (strlen($text) > MAX_INPUT_BYTES) {
                $error = 'Input is too large (limit is 100 KB).';
            } elseif ($text === '') {
                $error = 'Please enter some text.';
            } else {
                $result = $direction === 'encode'
                    ? Base64Service::encode($text)
                    : Base64Service::decode($text);
            }
        }
    } catch (\App\InvalidInputException $e) {
        // Expected, user-facing validation error.
        $error = $e->getMessage();
    } catch (\Throwable $e) {
        // Unexpected error: log internally, show generic message.
        error_log('[base64-tool] ' . $e->getMessage());
        http_response_code(500);
        $error = 'Something went wrong while processing your request.';
    }
}

$csrfToken = Csrf::token();

/**
 * Context-aware HTML escaping helper.
 */
function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Base64 Encoder / Decoder</title>
    <style>
        :root { color-scheme: light dark; }
        body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
        h1 { font-size: 1.4rem; }
        label { display: block; font-weight: 600; margin: 1rem 0 .25rem; }
        textarea { width: 100%; min-height: 8rem; font-family: ui-monospace, monospace; padding: .5rem; box-sizing: border-box; }
        .radios { display: flex; gap: 1.5rem; margin-top: .25rem; }
        .radios label { font-weight: 400; margin: 0; display: flex; gap: .4rem; align-items: center; }
        button { margin-top: 1rem; padding: .6rem 1.2rem; font-size: 1rem; cursor: pointer; }
        .result, .error { margin-top: 1.5rem; padding: 1rem; border-radius: 6px; }
        .result { background: rgba(0, 128, 0, .08); border: 1px solid rgba(0, 128, 0, .4); }
        .error { background: rgba(200, 0, 0, .08); border: 1px solid rgba(200, 0, 0, .4); }
        .result pre { white-space: pre-wrap; word-break: break-all; margin: .5rem 0 0; font-family: ui-monospace, monospace; }
    </style>
</head>
<body>
    <h1>Base64 Encoder / Decoder</h1>

    <form method="post" action="">
        <input type="hidden" name="csrf_token" value="<?= e($csrfToken) ?>">

        <label for="text">Text</label>
        <textarea id="text" name="text" maxlength="100000" autofocus><?= e($text) ?></textarea>

        <span class="radios-label" style="font-weight:600;">Direction</span>
        <div class="radios">
            <label>
                <input type="radio" name="direction" value="encode" <?= $direction !== 'decode' ? 'checked' : '' ?>>
                Encode
            </label>
            <label>
                <input type="radio" name="direction" value="decode" <?= $direction === 'decode' ? 'checked' : '' ?>>
                Decode
            </label>
        </div>

        <button type="submit">Convert</button>
    </form>

    <?php if ($error !== null): ?>
        <div class="error" role="alert"><?= e($error) ?></div>
    <?php endif; ?>

    <?php if ($result !== null): ?>
        <div class="result">
            <strong><?= $direction === 'encode' ? 'Encoded' : 'Decoded' ?> result:</strong>
            <pre><?= e($result) ?></pre>
        </div>
    <?php endif; ?>
</body>
</html>
