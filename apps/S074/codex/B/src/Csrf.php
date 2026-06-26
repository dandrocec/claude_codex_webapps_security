<?php

declare(strict_types=1);

namespace Marketplace;

final class Csrf
{
    public function __construct(private readonly Config $config)
    {
    }

    public function token(): string
    {
        if (!isset($_SESSION['csrf_nonce']) || !is_string($_SESSION['csrf_nonce'])) {
            $_SESSION['csrf_nonce'] = bin2hex(random_bytes(32));
        }

        return hash_hmac('sha256', session_id() . '|' . $_SESSION['csrf_nonce'], $this->config->appSecret);
    }

    public function verify(mixed $submitted): void
    {
        if (!is_string($submitted) || !hash_equals($this->token(), $submitted)) {
            http_response_code(419);
            exit('Invalid CSRF token');
        }
    }
}
