<?php
declare(strict_types=1);

const MAX_INPUT_BYTES = 10000;

$isHttps = (
    (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Lax');
ini_set('session.cookie_secure', $isHttps ? '1' : '0');

set_exception_handler(static function (Throwable $throwable): void {
    error_log($throwable->getMessage());
    http_response_code(500);
    echo 'An internal error occurred.';
});

header('Content-Type: text/html; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");

session_start();

if (empty($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

/**
 * Database access should always go through PDO prepared statements.
 * This app does not persist data, but the helper keeps the project aligned with
 * the required SQL-injection control if storage is added later.
 */
function pdo_from_env(): PDO
{
    $dsn = getenv('DATABASE_DSN');
    if ($dsn === false || $dsn === '') {
        throw new RuntimeException('DATABASE_DSN is not configured.');
    }

    return new PDO(
        $dsn,
        getenv('DATABASE_USER') ?: null,
        getenv('DATABASE_PASSWORD') ?: null,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
}

function hash_password(string $password): string
{
    return password_hash($password, PASSWORD_ARGON2ID);
}

function verify_password(string $password, string $hash): bool
{
    return password_verify($password, $hash);
}

function require_owned_resource(array $resource, int $currentUserId): void
{
    if (!isset($resource['user_id']) || (int) $resource['user_id'] !== $currentUserId) {
        http_response_code(403);
        exit('Forbidden');
    }
}

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function normalize_text_input(mixed $value): string
{
    if (!is_string($value)) {
        return '';
    }

    $value = str_replace(["\r\n", "\r"], "\n", $value);
    if (strlen($value) > MAX_INPUT_BYTES) {
        throw new InvalidArgumentException('Input is too long. Limit text to 10,000 bytes.');
    }

    return $value;
}

function base64_decode_strict(string $value): string
{
    $compact = preg_replace('/\s+/', '', $value);
    if ($compact === null || $compact === '') {
        return '';
    }

    if (!preg_match('/^[A-Za-z0-9+\/]*={0,2}$/', $compact) || strlen($compact) % 4 !== 0) {
        throw new InvalidArgumentException('Input is not valid Base64.');
    }

    $decoded = base64_decode($compact, true);
    if ($decoded === false) {
        throw new InvalidArgumentException('Input is not valid Base64.');
    }

    return $decoded;
}

$direction = 'encode';
$input = '';
$result = null;
$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $submittedToken = $_POST['csrf_token'] ?? '';
    if (!is_string($submittedToken) || !hash_equals($_SESSION['csrf_token'], $submittedToken)) {
        http_response_code(400);
        $error = 'The form expired. Please try again.';
    } else {
        try {
            $direction = $_POST['direction'] ?? 'encode';
            if (!in_array($direction, ['encode', 'decode'], true)) {
                throw new InvalidArgumentException('Choose encode or decode.');
            }

            $input = normalize_text_input($_POST['text'] ?? '');
            $result = $direction === 'encode'
                ? base64_encode($input)
                : base64_decode_strict($input);
        } catch (InvalidArgumentException $exception) {
            $error = $exception->getMessage();
        }
    }
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Base64 Tool</title>
    <style>
        :root {
            color-scheme: light dark;
            --bg: #f6f7f9;
            --panel: #ffffff;
            --text: #1f2937;
            --muted: #5b6472;
            --border: #cfd6df;
            --accent: #1f6feb;
            --accent-text: #ffffff;
            --danger: #b42318;
            --output: #eef4ff;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #111827;
                --panel: #1f2937;
                --text: #f9fafb;
                --muted: #c7ced8;
                --border: #4b5563;
                --accent: #58a6ff;
                --accent-text: #07111f;
                --danger: #ffb4a8;
                --output: #172033;
            }
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: var(--bg);
            color: var(--text);
            display: grid;
            place-items: center;
            padding: 24px;
        }

        main {
            width: min(760px, 100%);
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 28px;
            box-shadow: 0 16px 40px rgb(15 23 42 / 12%);
        }

        h1 {
            margin: 0 0 8px;
            font-size: 1.8rem;
            letter-spacing: 0;
        }

        p {
            margin: 0 0 22px;
            color: var(--muted);
        }

        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 650;
        }

        textarea {
            width: 100%;
            min-height: 180px;
            resize: vertical;
            padding: 12px;
            border: 1px solid var(--border);
            border-radius: 6px;
            background: transparent;
            color: var(--text);
            font: 1rem/1.45 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
        }

        .field {
            margin-bottom: 18px;
        }

        .choices {
            display: flex;
            flex-wrap: wrap;
            gap: 14px;
        }

        .choice {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
        }

        button {
            appearance: none;
            border: 0;
            border-radius: 6px;
            background: var(--accent);
            color: var(--accent-text);
            padding: 11px 18px;
            font: inherit;
            font-weight: 700;
            cursor: pointer;
        }

        button:focus,
        textarea:focus,
        input:focus {
            outline: 3px solid color-mix(in srgb, var(--accent), transparent 65%);
            outline-offset: 2px;
        }

        .message {
            margin-top: 20px;
            padding: 14px;
            border-radius: 6px;
            border: 1px solid var(--border);
        }

        .error {
            color: var(--danger);
        }

        .result {
            background: var(--output);
        }

        pre {
            margin: 8px 0 0;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            font: 1rem/1.45 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
        }
    </style>
</head>
<body>
<main>
    <h1>Base64 Tool</h1>
    <p>Encode text to Base64 or decode valid Base64 back to text.</p>

    <form method="post" action="/">
        <input type="hidden" name="csrf_token" value="<?= e($_SESSION['csrf_token']) ?>">

        <div class="field">
            <label for="text">Text</label>
            <textarea id="text" name="text" maxlength="<?= MAX_INPUT_BYTES ?>" required><?= e($input) ?></textarea>
        </div>

        <div class="field">
            <label>Direction</label>
            <div class="choices">
                <label class="choice">
                    <input type="radio" name="direction" value="encode" <?= $direction === 'encode' ? 'checked' : '' ?>>
                    Encode
                </label>
                <label class="choice">
                    <input type="radio" name="direction" value="decode" <?= $direction === 'decode' ? 'checked' : '' ?>>
                    Decode
                </label>
            </div>
        </div>

        <button type="submit">Convert</button>
    </form>

    <?php if ($error !== null): ?>
        <section class="message error" role="alert">
            <?= e($error) ?>
        </section>
    <?php endif; ?>

    <?php if ($result !== null && $error === null): ?>
        <section class="message result" aria-live="polite">
            <strong>Result</strong>
            <pre><?= e($result) ?></pre>
        </section>
    <?php endif; ?>
</main>
</body>
</html>
