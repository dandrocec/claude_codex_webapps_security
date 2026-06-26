<?php

declare(strict_types=1);

namespace Marketplace;

final class Config
{
    public function __construct(
        public readonly string $appSecret,
        public readonly string $databasePath,
        public readonly bool $isLocal,
    ) {
    }

    public static function fromEnvironment(string $root): self
    {
        $secret = getenv('APP_SECRET');
        if (!is_string($secret) || strlen($secret) < 32) {
            http_response_code(500);
            echo '<h1>Configuration error</h1><p>APP_SECRET must be set to at least 32 characters.</p>';
            exit;
        }

        $databasePath = getenv('DATABASE_PATH');
        if (!is_string($databasePath) || $databasePath === '') {
            $databasePath = $root . DIRECTORY_SEPARATOR . 'var' . DIRECTORY_SEPARATOR . 'marketplace.sqlite';
        }

        return new self(
            $secret,
            $databasePath,
            getenv('APP_ENV') === 'local',
        );
    }
}
