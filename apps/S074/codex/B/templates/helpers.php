<?php

declare(strict_types=1);

function e(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function money(int|string $cents): string
{
    return '$' . number_format(((int) $cents) / 100, 2);
}

function price_value(int|string $cents): string
{
    return number_format(((int) $cents) / 100, 2, '.', '');
}
