<?php

declare(strict_types=1);

namespace Guestbook;

final class Validation
{
    public static function credentials(array $input): array
    {
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        $password = (string) ($input['password'] ?? '');

        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
            throw new \RuntimeException('Enter a valid email address.');
        }

        if (strlen($password) < 12 || strlen($password) > 128) {
            throw new \RuntimeException('Passwords must be between 12 and 128 characters.');
        }

        return [$email, $password];
    }

    public static function message(array $input): array
    {
        $displayName = trim(preg_replace('/\s+/', ' ', (string) ($input['display_name'] ?? '')));
        $message = trim((string) ($input['message'] ?? ''));

        if ($displayName === '' || mb_strlen($displayName) > 80) {
            throw new \RuntimeException('Name is required and must be 80 characters or fewer.');
        }

        if ($message === '' || mb_strlen($message) > 1000) {
            throw new \RuntimeException('Message is required and must be 1000 characters or fewer.');
        }

        return [$displayName, $message];
    }

    public static function positiveInt(mixed $value, string $message): int
    {
        $filtered = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($filtered === false) {
            throw new \RuntimeException($message);
        }
        return $filtered;
    }
}
