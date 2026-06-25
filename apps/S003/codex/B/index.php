<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

$isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
$secureCookies = getenv('APP_SECURE_COOKIES');
$secureCookieFlag = $secureCookies === false ? $isHttps : filter_var($secureCookies, FILTER_VALIDATE_BOOLEAN);

session_set_cookie_params([
    'lifetime' => 0,
    'path' => '/',
    'domain' => '',
    'secure' => $secureCookieFlag,
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

$nonce = base64_encode(random_bytes(16));
header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
header("Content-Security-Policy: default-src 'self'; style-src 'self' 'nonce-$nonce'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");

function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function fail(string $message = 'The request could not be completed.'): void
{
    http_response_code(400);
    throw new RuntimeException($message);
}

function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function verify_csrf(): void
{
    $token = $_POST['csrf_token'] ?? '';
    if (!is_string($token) || !hash_equals($_SESSION['csrf_token'] ?? '', $token)) {
        fail('Your session expired. Please try again.');
    }
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dataDir = __DIR__ . DIRECTORY_SEPARATOR . 'data';
    if (!is_dir($dataDir) && !mkdir($dataDir, 0700, true) && !is_dir($dataDir)) {
        throw new RuntimeException('Storage is not available.');
    }

    $dsn = getenv('DATABASE_DSN') ?: 'sqlite:' . $dataDir . DIRECTORY_SEPARATOR . 'app.sqlite';
    $pdo = new PDO($dsn, getenv('DATABASE_USER') ?: null, getenv('DATABASE_PASSWORD') ?: null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec('CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS calculations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        bill_amount REAL NOT NULL,
        tip_percent REAL NOT NULL,
        people INTEGER NOT NULL,
        tip_amount REAL NOT NULL,
        total_amount REAL NOT NULL,
        per_person REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )');

    return $pdo;
}

function current_user_id(): ?int
{
    return isset($_SESSION['user_id']) ? (int) $_SESSION['user_id'] : null;
}

function require_user(): int
{
    $userId = current_user_id();
    if ($userId === null) {
        fail('Please sign in first.');
    }
    return $userId;
}

function clean_username(string $username): string
{
    $username = trim($username);
    if (!preg_match('/\A[a-zA-Z0-9_.-]{3,40}\z/', $username)) {
        fail('Use a username with 3-40 letters, numbers, dots, dashes, or underscores.');
    }
    return $username;
}

function clean_password(string $password): string
{
    if (strlen($password) < 12 || strlen($password) > 200) {
        fail('Use a password between 12 and 200 characters.');
    }
    return $password;
}

function clean_money(string $value, string $label): float
{
    $value = trim($value);
    if (!preg_match('/\A\d{1,7}(\.\d{1,2})?\z/', $value)) {
        fail("$label must be a positive amount with up to 2 decimals.");
    }
    $number = (float) $value;
    if ($number <= 0 || $number > 9999999.99) {
        fail("$label is outside the allowed range.");
    }
    return $number;
}

function clean_percent(string $value): float
{
    $value = trim($value);
    if (!preg_match('/\A\d{1,3}(\.\d{1,2})?\z/', $value)) {
        fail('Tip percentage must be between 0 and 100.');
    }
    $number = (float) $value;
    if ($number < 0 || $number > 100) {
        fail('Tip percentage must be between 0 and 100.');
    }
    return $number;
}

function clean_people(string $value): int
{
    $value = trim($value);
    if (!preg_match('/\A[1-9][0-9]{0,2}\z/', $value)) {
        fail('Number of people must be between 1 and 999.');
    }
    return (int) $value;
}

function load_history(int $userId): array
{
    $stmt = db()->prepare('SELECT id, bill_amount, tip_percent, people, tip_amount, total_amount, per_person, created_at
        FROM calculations WHERE user_id = :user_id ORDER BY id DESC LIMIT 5');
    $stmt->execute(['user_id' => $userId]);
    return $stmt->fetchAll();
}

$error = '';
$result = null;
$action = $_POST['action'] ?? '';

try {
    db();

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        verify_csrf();

        if ($action === 'register') {
            $username = clean_username((string) ($_POST['username'] ?? ''));
            $password = clean_password((string) ($_POST['password'] ?? ''));
            $hash = password_hash($password, PASSWORD_ARGON2ID);

            $stmt = db()->prepare('INSERT INTO users (username, password_hash) VALUES (:username, :password_hash)');
            $stmt->execute(['username' => $username, 'password_hash' => $hash]);
            session_regenerate_id(true);
            $_SESSION['user_id'] = (int) db()->lastInsertId();
            $_SESSION['username'] = $username;
        } elseif ($action === 'login') {
            $username = clean_username((string) ($_POST['username'] ?? ''));
            $password = (string) ($_POST['password'] ?? '');

            $stmt = db()->prepare('SELECT id, username, password_hash FROM users WHERE username = :username');
            $stmt->execute(['username' => $username]);
            $user = $stmt->fetch();

            if (!$user || !password_verify($password, $user['password_hash'])) {
                fail('Invalid username or password.');
            }

            session_regenerate_id(true);
            $_SESSION['user_id'] = (int) $user['id'];
            $_SESSION['username'] = $user['username'];
        } elseif ($action === 'logout') {
            $_SESSION = [];
            if (ini_get('session.use_cookies')) {
                $params = session_get_cookie_params();
                setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
            }
            session_destroy();
            session_start();
        } elseif ($action === 'calculate') {
            $userId = require_user();
            $bill = clean_money((string) ($_POST['bill_amount'] ?? ''), 'Bill amount');
            $tipPercent = clean_percent((string) ($_POST['tip_percent'] ?? ''));
            $people = clean_people((string) ($_POST['people'] ?? ''));
            $tip = round($bill * ($tipPercent / 100), 2);
            $total = round($bill + $tip, 2);
            $perPerson = round($total / $people, 2);

            $stmt = db()->prepare('INSERT INTO calculations
                (user_id, bill_amount, tip_percent, people, tip_amount, total_amount, per_person)
                VALUES (:user_id, :bill_amount, :tip_percent, :people, :tip_amount, :total_amount, :per_person)');
            $stmt->execute([
                'user_id' => $userId,
                'bill_amount' => $bill,
                'tip_percent' => $tipPercent,
                'people' => $people,
                'tip_amount' => $tip,
                'total_amount' => $total,
                'per_person' => $perPerson,
            ]);

            $result = [
                'tip' => $tip,
                'total' => $total,
                'per_person' => $perPerson,
            ];
        }
    }
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    $error = $exception instanceof RuntimeException ? $exception->getMessage() : 'Something went wrong. Please try again.';
}

$userId = current_user_id();
$history = $userId === null ? [] : load_history($userId);
$token = csrf_token();
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Tip Calculator</title>
    <style nonce="<?= e($nonce) ?>">
        :root {
            color-scheme: light;
            --bg: #f6f7f9;
            --panel: #ffffff;
            --text: #18202a;
            --muted: #687385;
            --line: #dce2ea;
            --accent: #116a6b;
            --accent-dark: #0a4b4c;
            --error: #9f1239;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            background: var(--bg);
            color: var(--text);
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            line-height: 1.5;
        }
        main {
            width: min(1040px, calc(100% - 32px));
            margin: 0 auto;
            padding: 40px 0;
        }
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
            margin-bottom: 28px;
        }
        h1, h2 { margin: 0; line-height: 1.15; }
        h1 { font-size: clamp(2rem, 5vw, 3.4rem); }
        h2 { font-size: 1.2rem; }
        .subtle { color: var(--muted); margin: 8px 0 0; }
        .grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
            gap: 20px;
            align-items: start;
        }
        .panel {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 8px;
            padding: 22px;
            box-shadow: 0 14px 35px rgba(24, 32, 42, 0.07);
        }
        form { display: grid; gap: 14px; }
        label { display: grid; gap: 6px; font-weight: 700; }
        input {
            width: 100%;
            border: 1px solid var(--line);
            border-radius: 6px;
            padding: 12px 13px;
            font: inherit;
            color: var(--text);
            background: #fff;
        }
        input:focus {
            outline: 3px solid rgba(17, 106, 107, 0.2);
            border-color: var(--accent);
        }
        button {
            border: 0;
            border-radius: 6px;
            padding: 12px 16px;
            font: inherit;
            font-weight: 800;
            color: #fff;
            background: var(--accent);
            cursor: pointer;
        }
        button:hover { background: var(--accent-dark); }
        .link-button {
            color: var(--accent);
            background: transparent;
            border: 1px solid var(--line);
            padding: 9px 12px;
        }
        .link-button:hover { background: #eef6f6; color: var(--accent-dark); }
        .auth-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }
        .message {
            border: 1px solid #fecdd3;
            background: #fff1f2;
            color: var(--error);
            padding: 12px 14px;
            border-radius: 6px;
            margin-bottom: 16px;
        }
        .results {
            display: grid;
            gap: 12px;
            margin-top: 18px;
        }
        .metric {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            border-bottom: 1px solid var(--line);
            padding-bottom: 12px;
        }
        .metric strong { font-size: 1.5rem; }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 14px;
            font-size: 0.95rem;
        }
        th, td {
            padding: 10px 8px;
            border-bottom: 1px solid var(--line);
            text-align: right;
        }
        th:first-child, td:first-child { text-align: left; }
        @media (max-width: 760px) {
            header, .grid { display: block; }
            header form { margin-top: 14px; }
            .panel { margin-bottom: 16px; }
            .auth-actions { grid-template-columns: 1fr; }
            th:nth-child(2), td:nth-child(2) { display: none; }
        }
    </style>
</head>
<body>
<main>
    <header>
        <div>
            <h1>Tip Calculator</h1>
            <p class="subtle">Split a bill cleanly and keep your recent calculations private to your account.</p>
        </div>
        <?php if ($userId !== null): ?>
            <form method="post">
                <input type="hidden" name="csrf_token" value="<?= e($token) ?>">
                <input type="hidden" name="action" value="logout">
                <button class="link-button" type="submit">Sign out <?= e((string) ($_SESSION['username'] ?? '')) ?></button>
            </form>
        <?php endif; ?>
    </header>

    <?php if ($error !== ''): ?>
        <div class="message" role="alert"><?= e($error) ?></div>
    <?php endif; ?>

    <?php if ($userId === null): ?>
        <section class="grid" aria-label="Account access">
            <div class="panel">
                <h2>Create an account</h2>
                <p class="subtle">Passwords are stored with Argon2id hashing.</p>
                <form method="post">
                    <input type="hidden" name="csrf_token" value="<?= e($token) ?>">
                    <input type="hidden" name="action" value="register">
                    <label>Username
                        <input name="username" autocomplete="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9_.-]{3,40}">
                    </label>
                    <label>Password
                        <input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="200">
                    </label>
                    <button type="submit">Register</button>
                </form>
            </div>
            <div class="panel">
                <h2>Sign in</h2>
                <p class="subtle">Use your account to calculate and view only your own recent entries.</p>
                <form method="post">
                    <input type="hidden" name="csrf_token" value="<?= e($token) ?>">
                    <input type="hidden" name="action" value="login">
                    <label>Username
                        <input name="username" autocomplete="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9_.-]{3,40}">
                    </label>
                    <label>Password
                        <input name="password" type="password" autocomplete="current-password" required>
                    </label>
                    <button type="submit">Sign in</button>
                </form>
            </div>
        </section>
    <?php else: ?>
        <section class="grid">
            <div class="panel">
                <h2>Bill details</h2>
                <form method="post">
                    <input type="hidden" name="csrf_token" value="<?= e($token) ?>">
                    <input type="hidden" name="action" value="calculate">
                    <label>Bill amount
                        <input name="bill_amount" inputmode="decimal" placeholder="84.50" required pattern="\d{1,7}(\.\d{1,2})?">
                    </label>
                    <label>Tip percentage
                        <input name="tip_percent" inputmode="decimal" placeholder="20" required pattern="\d{1,3}(\.\d{1,2})?">
                    </label>
                    <label>Number of people
                        <input name="people" inputmode="numeric" placeholder="4" required pattern="[1-9][0-9]{0,2}">
                    </label>
                    <button type="submit">Calculate split</button>
                </form>

                <section class="results" aria-live="polite" aria-label="Calculation results">
                    <div class="metric">
                        <span>Tip amount</span>
                        <strong>$<?= e(number_format((float) ($result['tip'] ?? 0), 2)) ?></strong>
                    </div>
                    <div class="metric">
                        <span>Total</span>
                        <strong>$<?= e(number_format((float) ($result['total'] ?? 0), 2)) ?></strong>
                    </div>
                    <div class="metric">
                        <span>Each person owes</span>
                        <strong>$<?= e(number_format((float) ($result['per_person'] ?? 0), 2)) ?></strong>
                    </div>
                </section>
            </div>

            <aside class="panel">
                <h2>Recent calculations</h2>
                <?php if ($history === []): ?>
                    <p class="subtle">No calculations yet.</p>
                <?php else: ?>
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">Bill</th>
                                <th scope="col">Tip</th>
                                <th scope="col">People</th>
                                <th scope="col">Each</th>
                            </tr>
                        </thead>
                        <tbody>
                        <?php foreach ($history as $row): ?>
                            <tr>
                                <td>$<?= e(number_format((float) $row['bill_amount'], 2)) ?></td>
                                <td><?= e(number_format((float) $row['tip_percent'], 2)) ?>%</td>
                                <td><?= e((string) $row['people']) ?></td>
                                <td>$<?= e(number_format((float) $row['per_person'], 2)) ?></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            </aside>
        </section>
    <?php endif; ?>
</main>
</body>
</html>
