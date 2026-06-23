<?php

declare(strict_types=1);

namespace App;

/**
 * Small input-validation helper. Centralises the "validate and sanitise all
 * user input" requirement (OWASP A03/A04).
 */
final class Validator
{
    /** @var array<string,string> */
    private array $errors = [];
    /** @var array<string,mixed> */
    private array $data;

    /** @param array<string,mixed> $source */
    public function __construct(array $source)
    {
        $this->data = $source;
    }

    public function string(string $field, bool $required = true, int $min = 0, int $max = 255): ?string
    {
        $value = isset($this->data[$field]) && is_scalar($this->data[$field])
            ? trim((string) $this->data[$field])
            : '';

        if ($value === '') {
            if ($required) {
                $this->errors[$field] = ucfirst($field) . ' is required.';
            }
            return $required ? null : '';
        }
        if (mb_strlen($value) < $min) {
            $this->errors[$field] = ucfirst($field) . " must be at least {$min} characters.";
            return null;
        }
        if (mb_strlen($value) > $max) {
            $this->errors[$field] = ucfirst($field) . " must be at most {$max} characters.";
            return null;
        }
        return $value;
    }

    public function email(string $field): ?string
    {
        $value = isset($this->data[$field]) && is_scalar($this->data[$field])
            ? trim((string) $this->data[$field])
            : '';
        $clean = filter_var($value, FILTER_VALIDATE_EMAIL);
        if ($clean === false) {
            $this->errors[$field] = 'A valid email address is required.';
            return null;
        }
        return strtolower($clean);
    }

    /** Money expressed as a decimal string; returns integer cents. */
    public function priceCents(string $field): ?int
    {
        $raw = isset($this->data[$field]) && is_scalar($this->data[$field])
            ? trim((string) $this->data[$field])
            : '';
        if (!preg_match('/^\d{1,7}(\.\d{1,2})?$/', $raw)) {
            $this->errors[$field] = 'Enter a valid price (e.g. 19.99).';
            return null;
        }
        $cents = (int) round((float) $raw * 100);
        if ($cents <= 0) {
            $this->errors[$field] = 'Price must be greater than zero.';
            return null;
        }
        return $cents;
    }

    public function int(string $field, int $min, int $max): ?int
    {
        $raw = $this->data[$field] ?? null;
        if (!is_scalar($raw) || !preg_match('/^\d+$/', (string) $raw)) {
            $this->errors[$field] = ucfirst($field) . ' must be a whole number.';
            return null;
        }
        $value = (int) $raw;
        if ($value < $min || $value > $max) {
            $this->errors[$field] = ucfirst($field) . " must be between {$min} and {$max}.";
            return null;
        }
        return $value;
    }

    public function inList(string $field, array $allowed): ?string
    {
        $value = isset($this->data[$field]) && is_scalar($this->data[$field])
            ? (string) $this->data[$field]
            : '';
        if (!in_array($value, $allowed, true)) {
            $this->errors[$field] = 'Invalid selection.';
            return null;
        }
        return $value;
    }

    public function passes(): bool
    {
        return $this->errors === [];
    }

    /** @return array<string,string> */
    public function errors(): array
    {
        return $this->errors;
    }

    public function addError(string $field, string $message): void
    {
        $this->errors[$field] = $message;
    }
}
