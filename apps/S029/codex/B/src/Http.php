<?php

declare(strict_types=1);

namespace Guestbook;

final class Http
{
    public static function redirect(string $path): never
    {
        header('Location: ' . $path, true, 303);
        exit;
    }
}
