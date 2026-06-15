<?php

declare(strict_types=1);

namespace App;

/**
 * Pure Base64 encode/decode logic with strict validation.
 */
final class Base64Service
{
    /**
     * Base64-encode arbitrary text.
     */
    public static function encode(string $text): string
    {
        return base64_encode($text);
    }

    /**
     * Base64-decode input, rejecting malformed data.
     *
     * @throws InvalidInputException when the input is not valid Base64.
     */
    public static function decode(string $text): string
    {
        // Tolerate surrounding whitespace/newlines that users often paste.
        $candidate = preg_replace('/\s+/', '', $text) ?? '';

        // strict mode returns false on any character outside the alphabet.
        $decoded = base64_decode($candidate, true);

        if ($decoded === false) {
            throw new InvalidInputException('Input is not valid Base64.');
        }

        return $decoded;
    }
}
