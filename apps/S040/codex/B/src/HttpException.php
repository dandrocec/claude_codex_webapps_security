<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class HttpException extends RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $safeMessage)
    {
        parent::__construct($safeMessage, $status);
    }
}
