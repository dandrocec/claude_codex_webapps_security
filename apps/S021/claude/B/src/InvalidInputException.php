<?php

declare(strict_types=1);

namespace App;

/**
 * Thrown for expected, user-facing input validation failures.
 * The message is safe to display to the client.
 */
final class InvalidInputException extends \RuntimeException
{
}
