<?php

declare(strict_types=1);

namespace SecurePoll;

final class App
{
    private const QUESTION = 'Which improvement should we prioritize next?';

    private const OPTIONS = [
        'speed' => 'Faster page loading',
        'accessibility' => 'Better accessibility',
        'dark_mode' => 'Dark mode',
    ];

    private string $dataFile;
    private string $secret;

    public function __construct()
    {
        $this->dataFile = dirname(__DIR__) . '/data/votes.json';
        $this->secret = getenv('APP_SECRET') ?: '';
    }

    public function run(): void
    {
        $this->configureErrorHandling();
        $this->sendSecurityHeaders();
        $this->startSecureSession();

        if ($this->secret === '') {
            $this->renderError(500, 'Application secret is not configured.');
            return;
        }

        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $this->handleVote();
            return;
        }

        if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
            $this->renderError(405, 'Method not allowed.');
            return;
        }

        $this->renderPoll(null);
    }

    private function configureErrorHandling(): void
    {
        ini_set('display_errors', '0');
        ini_set('log_errors', '1');
        error_reporting(E_ALL);

        set_exception_handler(function (\Throwable $throwable): void {
            error_log($throwable->getMessage());
            $this->renderError(500, 'An internal error occurred.');
        });
    }

    private function sendSecurityHeaders(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: no-referrer');
        header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
        header("Content-Security-Policy: default-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; style-src 'self' 'unsafe-inline'");
        header('Cache-Control: no-store');
    }

    private function startSecureSession(): void
    {
        $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

        session_name('secure_poll_session');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'domain' => '',
            'secure' => $isHttps,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();

        if (!isset($_SESSION['created_at'])) {
            session_regenerate_id(true);
            $_SESSION['created_at'] = time();
        }
    }

    private function handleVote(): void
    {
        $token = $this->stringPostValue('csrf_token');
        if (!$this->isValidCsrfToken($token)) {
            $this->renderError(403, 'Invalid request token.');
            return;
        }

        $option = $this->stringPostValue('option');
        if (!array_key_exists($option, self::OPTIONS)) {
            $this->renderPoll('Please choose a valid option.');
            return;
        }

        $this->recordVote($option);

        $_SESSION['last_vote'] = $option;
        $this->redirect('/');
    }

    private function renderPoll(?string $message): void
    {
        $votes = $this->readVotes();
        $csrfToken = $this->csrfToken();
        $lastVote = $_SESSION['last_vote'] ?? null;
        unset($_SESSION['last_vote']);

        http_response_code(200);
        echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
        echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
        echo '<title>Secure Poll</title>';
        echo '<style>';
        echo 'body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f5f7fb;color:#172033}';
        echo '.wrap{max-width:760px;margin:0 auto;padding:48px 20px}.panel{background:#fff;border:1px solid #d9e0ec;border-radius:8px;padding:28px;box-shadow:0 10px 28px rgba(23,32,51,.08)}';
        echo 'h1{font-size:1.8rem;margin:0 0 20px}.option{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid #edf1f7}.option:first-of-type{border-top:0}';
        echo 'button{margin-top:20px;border:0;border-radius:6px;background:#175cd3;color:#fff;font-weight:700;padding:12px 18px;cursor:pointer}';
        echo '.msg{padding:10px 12px;border-radius:6px;margin-bottom:16px;background:#fff1f1;color:#8a1f1f}.ok{background:#effaf3;color:#176034}.tally{margin-top:28px}.bar{height:10px;background:#e7ecf5;border-radius:999px;overflow:hidden}.fill{height:100%;background:#1f7a4d}.row{margin:14px 0}.meta{display:flex;justify-content:space-between;gap:16px;margin-bottom:6px}';
        echo '</style></head><body><main class="wrap"><section class="panel">';
        echo '<h1>' . $this->e(self::QUESTION) . '</h1>';

        if ($message !== null) {
            echo '<div class="msg" role="alert">' . $this->e($message) . '</div>';
        }

        if (is_string($lastVote) && array_key_exists($lastVote, self::OPTIONS)) {
            echo '<div class="msg ok" role="status">Vote recorded for ' . $this->e(self::OPTIONS[$lastVote]) . '.</div>';
        }

        echo '<form method="post" action="/">';
        echo '<input type="hidden" name="csrf_token" value="' . $this->e($csrfToken) . '">';
        foreach (self::OPTIONS as $key => $label) {
            echo '<label class="option">';
            echo '<input type="radio" name="option" value="' . $this->e($key) . '" required>';
            echo '<span>' . $this->e($label) . '</span>';
            echo '</label>';
        }
        echo '<button type="submit">Submit Vote</button>';
        echo '</form>';

        $total = array_sum($votes);
        echo '<div class="tally" aria-live="polite"><h2>Current Tally</h2>';
        foreach (self::OPTIONS as $key => $label) {
            $count = $votes[$key] ?? 0;
            $percent = $total > 0 ? (int) round(($count / $total) * 100) : 0;
            echo '<div class="row">';
            echo '<div class="meta"><strong>' . $this->e($label) . '</strong><span>' . $this->e((string) $count) . ' votes (' . $this->e((string) $percent) . '%)</span></div>';
            echo '<div class="bar" aria-hidden="true"><div class="fill" style="width:' . $this->e((string) $percent) . '%"></div></div>';
            echo '</div>';
        }
        echo '</div></section></main></body></html>';
    }

    private function readVotes(): array
    {
        $this->ensureDataFile();
        $handle = fopen($this->dataFile, 'rb');
        if ($handle === false) {
            throw new \RuntimeException('Unable to open votes file.');
        }

        flock($handle, LOCK_SH);
        $content = stream_get_contents($handle);
        flock($handle, LOCK_UN);
        fclose($handle);

        $decoded = json_decode($content ?: '{}', true);
        if (!is_array($decoded)) {
            $decoded = [];
        }

        return $this->normalisedVotes($decoded);
    }

    private function recordVote(string $option): void
    {
        $this->ensureDataFile();
        $handle = fopen($this->dataFile, 'c+b');
        if ($handle === false) {
            throw new \RuntimeException('Unable to update votes file.');
        }

        flock($handle, LOCK_EX);
        rewind($handle);
        $content = stream_get_contents($handle);
        $decoded = json_decode($content ?: '{}', true);
        $votes = is_array($decoded) ? $this->normalisedVotes($decoded) : $this->normalisedVotes([]);
        $votes[$option]++;

        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($votes, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
        fflush($handle);
        flock($handle, LOCK_UN);
        fclose($handle);
    }

    private function ensureDataFile(): void
    {
        $directory = dirname($this->dataFile);
        if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) {
            throw new \RuntimeException('Unable to create data directory.');
        }

        if (!is_file($this->dataFile)) {
            $initialVotes = $this->normalisedVotes([]);
            file_put_contents($this->dataFile, json_encode($initialVotes, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), LOCK_EX);
            chmod($this->dataFile, 0640);
        }
    }

    private function normalisedVotes(array $votes): array
    {
        $normalised = [];
        foreach (self::OPTIONS as $key => $_label) {
            $value = $votes[$key] ?? 0;
            $normalised[$key] = is_int($value) && $value >= 0 ? $value : 0;
        }

        return $normalised;
    }

    private function csrfToken(): string
    {
        if (!isset($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        return $_SESSION['csrf_token'];
    }

    private function isValidCsrfToken(string $token): bool
    {
        return isset($_SESSION['csrf_token'])
            && is_string($_SESSION['csrf_token'])
            && hash_equals($_SESSION['csrf_token'], $token);
    }

    private function stringPostValue(string $key): string
    {
        $value = filter_input(INPUT_POST, $key, FILTER_UNSAFE_RAW);
        if (!is_string($value)) {
            return '';
        }

        return trim($value);
    }

    private function renderError(int $status, string $message): void
    {
        http_response_code($status);
        echo '<!doctype html><html lang="en"><head><meta charset="utf-8">';
        echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
        echo '<title>Error</title></head><body>';
        echo '<h1>' . $this->e($message) . '</h1>';
        echo '</body></html>';
    }

    private function redirect(string $path): void
    {
        header('Location: ' . $path, true, 303);
    }

    private function e(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
