<?php

declare(strict_types=1);

namespace Forum;

final class Validation
{
    public static function string(mixed $value, int $max): string
    {
        $value = is_string($value) ? trim($value) : '';
        $value = preg_replace('/[^\P{C}\t\r\n]/u', '', $value) ?? '';
        return mb_substr($value, 0, $max);
    }

    public static function username(mixed $value): string
    {
        $value = self::string($value, 32);
        return preg_match('/\A[a-zA-Z0-9_]{3,32}\z/', $value) ? $value : '';
    }

    public static function password(mixed $value): string
    {
        return is_string($value) && strlen($value) >= 10 && strlen($value) <= 200 ? $value : '';
    }

    public static function id(mixed $value): int
    {
        return filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) ?: 0;
    }
}
