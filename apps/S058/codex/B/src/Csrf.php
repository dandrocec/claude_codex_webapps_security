<?php

declare(strict_types=1);

namespace Forum;

final class Csrf
{
    public function token(): string
    {
        if (empty($_SESSION['csrf_token']) || !is_string($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf_token'];
    }

    public function field(): string
    {
        return '<input type="hidden" name="csrf_token" value="' . Security::e($this->token()) . '">';
    }

    public function verify(string $token): void
    {
        $stored = $_SESSION['csrf_token'] ?? '';
        if (!is_string($stored) || !hash_equals($stored, $token)) {
            http_response_code(419);
            echo '<!doctype html><meta charset="utf-8"><title>Invalid request</title><p>Invalid request token.</p>';
            exit;
        }
    }
}
