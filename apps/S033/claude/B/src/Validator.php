<?php

declare(strict_types=1);

namespace App;

/**
 * Input validation and normalisation. Collects per-field error messages so a
 * form can report everything wrong at once.
 */
final class Validator
{
    /** @var array<string, string> */
    private array $errors = [];

    /** @var array<string, string> */
    private array $clean = [];

    /**
     * Trim and collapse a raw string input. Returns null when the key is absent
     * or not a string (e.g. unexpected array input).
     */
    public static function str(array $source, string $key): ?string
    {
        if (!array_key_exists($key, $source) || !is_string($source[$key])) {
            return null;
        }

        // Normalise CR/LF, strip control chars except tab/newline, trim ends.
        $value = str_replace(["\r\n", "\r"], "\n", $source[$key]);
        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';

        return trim($value);
    }

    public function require(string $field, ?string $value, string $label, int $max = 255): self
    {
        $value ??= '';
        if ($value === '') {
            $this->errors[$field] = "$label is required.";
        } elseif (mb_strlen($value) > $max) {
            $this->errors[$field] = "$label must be at most $max characters.";
        } else {
            $this->clean[$field] = $value;
        }

        return $this;
    }

    public function optional(string $field, ?string $value, string $label, int $max = 255): self
    {
        $value ??= '';
        if (mb_strlen($value) > $max) {
            $this->errors[$field] = "$label must be at most $max characters.";
        } else {
            $this->clean[$field] = $value;
        }

        return $this;
    }

    public function email(string $field, ?string $value, string $label, bool $required = true, int $max = 255): self
    {
        $value = $value !== null ? trim($value) : '';

        if ($value === '') {
            if ($required) {
                $this->errors[$field] = "$label is required.";
            } else {
                $this->clean[$field] = '';
            }

            return $this;
        }

        if (mb_strlen($value) > $max || !filter_var($value, FILTER_VALIDATE_EMAIL)) {
            $this->errors[$field] = "$label must be a valid email address.";

            return $this;
        }

        $this->clean[$field] = mb_strtolower($value);

        return $this;
    }

    public function phone(string $field, ?string $value, string $label, int $max = 64): self
    {
        $value ??= '';
        if ($value === '') {
            $this->clean[$field] = '';

            return $this;
        }

        if (mb_strlen($value) > $max || !preg_match('/^[0-9+()\-.\s]+$/', $value)) {
            $this->errors[$field] = "$label may only contain digits and + ( ) - . spaces.";

            return $this;
        }

        $this->clean[$field] = $value;

        return $this;
    }

    public function passwordStrength(string $field, ?string $value, int $min = 10, int $max = 200): self
    {
        $value ??= '';
        $len = strlen($value);
        if ($len < $min) {
            $this->errors[$field] = "Password must be at least $min characters.";
        } elseif ($len > $max) {
            $this->errors[$field] = "Password must be at most $max characters.";
        } else {
            $this->clean[$field] = $value;
        }

        return $this;
    }

    public function fails(): bool
    {
        return $this->errors !== [];
    }

    /** @return array<string, string> */
    public function errors(): array
    {
        return $this->errors;
    }

    public function addError(string $field, string $message): void
    {
        $this->errors[$field] = $message;
    }

    public function value(string $field): string
    {
        return $this->clean[$field] ?? '';
    }

    /** @return array<string, string> */
    public function clean(): array
    {
        return $this->clean;
    }
}
