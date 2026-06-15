<?php

declare(strict_types=1);

namespace App;

/**
 * One-shot flash messages stored in the session and cleared on read.
 */
final class Flash
{
    public static function set(string $type, string $message): void
    {
        $_SESSION['__flash'][] = ['type' => $type, 'message' => $message];
    }

    /** @return array<int, array{type: string, message: string}> */
    public static function pull(): array
    {
        $messages = $_SESSION['__flash'] ?? [];
        unset($_SESSION['__flash']);

        return is_array($messages) ? $messages : [];
    }
}
