<?php

declare(strict_types=1);

use App\Security;

function e(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . e(Security::csrf()) . '">';
}

function money(int $cents): string
{
    return '$' . number_format($cents / 100, 2);
}
