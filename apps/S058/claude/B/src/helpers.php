<?php
declare(strict_types=1);

/* ---------------------------------------------------------------------------
 * Output encoding
 * ------------------------------------------------------------------------- */

if (!function_exists('e')) {
    /** Context-aware HTML escaping for all user-controlled output (anti-XSS). */
    function e(?string $value): string
    {
        return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}

/* ---------------------------------------------------------------------------
 * Sessions & security headers
 * ------------------------------------------------------------------------- */

if (!function_exists('start_session')) {
    function start_session(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $cfg = config();
        session_name($cfg['session_name']);
        // Secure session cookie: HttpOnly, SameSite=Lax, Secure (when on HTTPS).
        session_set_cookie_params([
            'lifetime' => 0,
            'path'     => '/',
            'domain'   => '',
            'secure'   => $cfg['secure_cookie'],
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        session_start();
    }
}

if (!function_exists('send_security_headers')) {
    function send_security_headers(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: no-referrer');
        header('Cross-Origin-Opener-Policy: same-origin');
        header_remove('X-Powered-By');
        // Strict CSP: no inline scripts; one small inline <style> is allowed.
        header(
            "Content-Security-Policy: default-src 'none'; "
            . "style-src 'self' 'unsafe-inline'; "
            . "form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
        );
        if (config()['secure_cookie']) {
            header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
        }
    }
}

/* ---------------------------------------------------------------------------
 * CSRF protection
 * ------------------------------------------------------------------------- */

if (!function_exists('csrf_token')) {
    function csrf_token(): string
    {
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf_token'];
    }
}

if (!function_exists('csrf_field')) {
    function csrf_field(): string
    {
        return '<input type="hidden" name="csrf_token" value="' . e(csrf_token()) . '">';
    }
}

if (!function_exists('verify_csrf')) {
    function verify_csrf(): void
    {
        $sent = (string) ($_POST['csrf_token'] ?? '');
        $known = (string) ($_SESSION['csrf_token'] ?? '');
        if ($known === '' || !hash_equals($known, $sent)) {
            abort(419, 'Invalid or missing CSRF token. Please reload and try again.');
        }
    }
}

/* ---------------------------------------------------------------------------
 * Authentication & authorisation
 * ------------------------------------------------------------------------- */

if (!function_exists('current_user')) {
    /** @return array<string,mixed>|null */
    function current_user(): ?array
    {
        static $cached = false;
        static $user = null;
        if ($cached) {
            return $user;
        }
        $cached = true;
        $id = $_SESSION['user_id'] ?? null;
        if (!$id) {
            return null;
        }
        try {
            $stmt = db()->prepare('SELECT id, username, role, created_at FROM users WHERE id = :id');
            $stmt->execute([':id' => $id]);
            $row = $stmt->fetch();
        } catch (Throwable $e) {
            // Never let user lookup crash the error page itself.
            return null;
        }
        $user = $row ?: null;
        return $user;
    }
}

if (!function_exists('is_moderator')) {
    function is_moderator(): bool
    {
        $u = current_user();
        return $u !== null && $u['role'] === 'moderator';
    }
}

if (!function_exists('require_login')) {
    function require_login(): array
    {
        $u = current_user();
        if ($u === null) {
            redirect('/login');
        }
        return $u;
    }
}

if (!function_exists('login_user')) {
    function login_user(int $userId): void
    {
        // Prevent session fixation by rotating the session id on privilege change.
        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
    }
}

if (!function_exists('logout_user')) {
    function logout_user(): void
    {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires'  => time() - 42000,
                'path'     => $p['path'],
                'domain'   => $p['domain'],
                'secure'   => $p['secure'],
                'httponly' => $p['httponly'],
                'samesite' => $p['samesite'] ?? 'Lax',
            ]);
        }
        session_destroy();
    }
}

/* ---------------------------------------------------------------------------
 * Request / response helpers
 * ------------------------------------------------------------------------- */

if (!function_exists('redirect')) {
    function redirect(string $path): never
    {
        header('Location: ' . $path, true, 302);
        exit;
    }
}

if (!function_exists('abort')) {
    function abort(int $status, string $message = ''): never
    {
        http_response_code($status);
        $titles = [400 => 'Bad Request', 403 => 'Forbidden', 404 => 'Not Found', 419 => 'Expired', 405 => 'Method Not Allowed', 500 => 'Server Error'];
        $title = $titles[$status] ?? 'Error';
        render('error', ['status' => $status, 'title' => $title, 'message' => $message], $title);
        exit;
    }
}

if (!function_exists('require_post')) {
    function require_post(): void
    {
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
            abort(405, 'Method not allowed.');
        }
    }
}

if (!function_exists('flash')) {
    function flash(?string $message = null): ?string
    {
        if ($message !== null) {
            $_SESSION['flash'] = $message;
            return null;
        }
        $msg = $_SESSION['flash'] ?? null;
        unset($_SESSION['flash']);
        return $msg;
    }
}

/* ---------------------------------------------------------------------------
 * Input validation
 * ------------------------------------------------------------------------- */

if (!function_exists('str_input')) {
    /** Trim and normalise a string field from the request. */
    function str_input(string $key): string
    {
        $v = $_POST[$key] ?? '';
        if (!is_string($v)) {
            return '';
        }
        // Normalise line endings; strip control chars except tab/newline.
        $v = str_replace(["\r\n", "\r"], "\n", $v);
        $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $v) ?? '';
        return trim($v);
    }
}

if (!function_exists('render')) {
    /** @param array<string,mixed> $data */
    function render(string $view, array $data = [], ?string $title = null): void
    {
        $viewFile = dirname(__DIR__) . '/src/views/' . $view . '.php';
        if (!is_file($viewFile)) {
            throw new RuntimeException('View not found: ' . $view);
        }
        $pageTitle = $title ?? 'Forum';
        extract($data, EXTR_SKIP);
        ob_start();
        require $viewFile;
        $content = ob_get_clean();
        require dirname(__DIR__) . '/src/views/layout.php';
    }
}
