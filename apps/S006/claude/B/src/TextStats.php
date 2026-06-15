<?php

declare(strict_types=1);

namespace App;

/**
 * Pure text-statistics logic. Operates on already-validated UTF-8 text with
 * newlines normalised to "\n".
 */
final class TextStats
{
    /**
     * @return array{characters:int, words:int, lines:int}
     */
    public static function analyse(string $text): array
    {
        return [
            'characters' => self::countCharacters($text),
            'words' => self::countWords($text),
            'lines' => self::countLines($text),
        ];
    }

    public static function countCharacters(string $text): int
    {
        return mb_strlen($text, 'UTF-8');
    }

    public static function countWords(string $text): int
    {
        $trimmed = trim($text);
        if ($trimmed === '') {
            return 0;
        }
        // Split on any Unicode whitespace run.
        $parts = preg_split('/\s+/u', $trimmed, -1, PREG_SPLIT_NO_EMPTY);

        return $parts === false ? 0 : count($parts);
    }

    public static function countLines(string $text): int
    {
        if ($text === '') {
            return 0;
        }
        // Count newline separators; the final line may lack a trailing newline.
        $newlines = substr_count($text, "\n");

        return str_ends_with($text, "\n") ? $newlines : $newlines + 1;
    }
}
