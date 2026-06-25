<?php

declare(strict_types=1);

namespace App;

final class Response
{
    public static function redirect(string $path): never
    {
        header('Location: ' . $path, true, 303);
        exit;
    }
}
