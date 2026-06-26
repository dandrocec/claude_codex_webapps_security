<?php

declare(strict_types=1);

namespace Marketplace;

final class Validator
{
    public static function text(mixed $value, int $min, int $max): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = trim($value);
        $length = mb_strlen($value);
        if ($length < $min || $length > $max) {
            return null;
        }
        return preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value);
    }

    public static function email(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $value = mb_strtolower(trim($value));
        return filter_var($value, FILTER_VALIDATE_EMAIL) ? $value : null;
    }

    public static function password(mixed $value): ?string
    {
        return is_string($value) && strlen($value) >= 10 && strlen($value) <= 256 ? $value : null;
    }

    public static function role(mixed $value): ?string
    {
        return in_array($value, ['buyer', 'vendor'], true) ? $value : null;
    }

    public static function intRange(mixed $value, int $min, int $max): ?int
    {
        $int = filter_var($value, FILTER_VALIDATE_INT);
        if (!is_int($int) || $int < $min || $int > $max) {
            return null;
        }
        return $int;
    }

    public static function priceToCents(mixed $value): ?int
    {
        if (!is_string($value) || !preg_match('/^\d{1,7}(\.\d{1,2})?$/', $value)) {
            return null;
        }
        [$dollars, $cents] = array_pad(explode('.', $value, 2), 2, '0');
        return ((int) $dollars * 100) + (int) str_pad($cents, 2, '0');
    }
}
