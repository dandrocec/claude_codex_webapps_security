<?php

declare(strict_types=1);

/**
 * Text Analyzer — counts characters, words, and lines in submitted text
 * and echoes the text back for reference.
 *
 * Security posture (OWASP Top 10):
 *  - A01 Broken Access Control / IDOR: no cross-user resources exist; the only
 *    state is the per-session CSRF token, scoped to the caller's own session.
 *  - A02 Cryptographic Failures: secrets are read from the environment, never
 *    hardcoded; the CSRF token uses a CSPRNG (random_bytes).
 *  - A03 Injection: no SQL/DB is used. Output is context-aware encoded with
 *    htmlspecialchars to prevent XSS. If a DB is later added, use PDO prepared
 *    statements (see README) — never string concatenation.
 *  - A05 Security Misconfiguration: hardened security headers + secure session
 *    cookie flags are set on every request; display_errors is off.
 *  - A07 Identification/Auth: password hashing helper provided (password_hash
 *    with bcrypt/Argon2) for when auth is introduced.
 *  - A09 Logging/Error Handling: internal errors are logged, never shown to
 *    the client (no stack traces leak).
 */

require __DIR__ . '/../src/bootstrap.php';

use App\Csrf;
use App\Security;
use App\TextStats;

Security::sendHeaders();
Security::startSecureSession();

$errors = [];
$stats = null;
$submittedText = '';

// Cap input size to mitigate resource-exhaustion (DoS) on the counters.
const MAX_INPUT_BYTES = 100_000; // ~100 KB of text

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // --- CSRF protection on this state-changing request ---
    $token = is_string($_POST['csrf_token'] ?? null) ? $_POST['csrf_token'] : '';
    if (!Csrf::validate($token)) {
        http_response_code(400);
        $errors[] = 'Invalid or expired form token. Please reload the page and try again.';
    } else {
        // --- Input validation & normalisation ---
        $raw = $_POST['text'] ?? '';
        if (!is_string($raw)) {
            $errors[] = 'Unexpected input.';
        } elseif (strlen($raw) > MAX_INPUT_BYTES) {
            $errors[] = 'Input is too large (max ' . number_format(MAX_INPUT_BYTES) . ' bytes).';
        } else {
            // Normalise newlines and reject invalid UTF-8 early.
            $normalised = str_replace(["\r\n", "\r"], "\n", $raw);
            if (!mb_check_encoding($normalised, 'UTF-8')) {
                $errors[] = 'Input must be valid UTF-8 text.';
            } else {
                $submittedText = $normalised;
                $stats = TextStats::analyse($submittedText);
            }
        }
    }
}

// Rotate/issue a token for the next request.
$csrfToken = Csrf::token();

/**
 * Context-aware output encoding helper for the HTML body context.
 */
function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Text Analyzer</title>
    <style>
        :root { color-scheme: light dark; }
        body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5;
        }
        h1 { margin-bottom: .25rem; }
        .subtitle { color: #666; margin-top: 0; }
        textarea {
            width: 100%; min-height: 12rem; padding: .75rem; box-sizing: border-box;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .95rem;
        }
        button {
            margin-top: .75rem; padding: .55rem 1.2rem; font-size: 1rem; cursor: pointer;
            border: 1px solid #888; border-radius: 6px; background: #2563eb; color: #fff;
        }
        button:hover { background: #1d4ed8; }
        .errors { background: #fee2e2; color: #991b1b; padding: .75rem 1rem; border-radius: 6px; }
        .errors ul { margin: .25rem 0 0; padding-left: 1.2rem; }
        .stats { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1.5rem 0; }
        .card {
            flex: 1 1 8rem; background: rgba(127,127,127,.12); border-radius: 8px;
            padding: 1rem; text-align: center;
        }
        .card .num { font-size: 2rem; font-weight: 700; display: block; }
        .card .label { color: #666; text-transform: uppercase; font-size: .75rem; letter-spacing: .05em; }
        .echo { background: rgba(127,127,127,.08); border-radius: 8px; padding: 1rem; white-space: pre-wrap; word-break: break-word; }
        h2 { font-size: 1.05rem; }
    </style>
</head>
<body>
    <h1>Text Analyzer</h1>
    <p class="subtitle">Paste text to count characters, words, and lines.</p>

    <?php if ($errors): ?>
        <div class="errors" role="alert">
            <strong>There was a problem:</strong>
            <ul>
                <?php foreach ($errors as $error): ?>
                    <li><?= h($error) ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    <?php endif; ?>

    <form method="post" action="">
        <input type="hidden" name="csrf_token" value="<?= h($csrfToken) ?>">
        <label for="text"><strong>Your text</strong></label><br>
        <textarea id="text" name="text" autofocus><?= h($submittedText) ?></textarea>
        <br>
        <button type="submit">Analyze</button>
    </form>

    <?php if ($stats !== null): ?>
        <section aria-label="Results">
            <div class="stats">
                <div class="card">
                    <span class="num"><?= h((string) $stats['characters']) ?></span>
                    <span class="label">Characters</span>
                </div>
                <div class="card">
                    <span class="num"><?= h((string) $stats['words']) ?></span>
                    <span class="label">Words</span>
                </div>
                <div class="card">
                    <span class="num"><?= h((string) $stats['lines']) ?></span>
                    <span class="label">Lines</span>
                </div>
            </div>

            <h2>Submitted text</h2>
            <div class="echo"><?= h($submittedText) ?></div>
        </section>
    <?php endif; ?>
</body>
</html>
