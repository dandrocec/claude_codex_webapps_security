<?php

declare(strict_types=1);

namespace App;

final class Input
{
    public static function string(string $key, int $maxLength, int $source = INPUT_POST): string
    {
        $value = filter_input($source, $key, FILTER_UNSAFE_RAW);
        if (!is_string($value)) {
            return '';
        }
        $value = trim(str_replace("\0", '', $value));
        return mb_substr($value, 0, $maxLength);
    }

    public static function int(string $key, int $source = INPUT_POST): ?int
    {
        $value = filter_input($source, $key, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        return $value === false || $value === null ? null : $value;
    }

    public static function requiredInt(string $key, int $source = INPUT_POST): int
    {
        $value = self::int($key, $source);
        if ($value === null) {
            throw new HttpException(400, 'Invalid request');
        }
        return $value;
    }
}
