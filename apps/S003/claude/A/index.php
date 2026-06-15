<?php
declare(strict_types=1);

/**
 * Single-page tip calculator.
 * Reads the submitted form values, validates them, and computes the
 * tip amount, grand total, and per-person share.
 */

$errors = [];
$result = null;

// Preserve submitted values so the form can be re-populated after submit.
$bill = $_POST['bill'] ?? '';
$tip = $_POST['tip'] ?? '';
$people = $_POST['people'] ?? '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (!is_numeric($bill) || (float) $bill < 0) {
        $errors[] = 'Bill amount must be a number that is zero or greater.';
    }
    if (!is_numeric($tip) || (float) $tip < 0) {
        $errors[] = 'Tip percentage must be a number that is zero or greater.';
    }
    if (filter_var($people, FILTER_VALIDATE_INT) === false || (int) $people < 1) {
        $errors[] = 'Number of people must be a whole number of at least 1.';
    }

    if (!$errors) {
        $billAmount = (float) $bill;
        $tipPercent = (float) $tip;
        $peopleCount = (int) $people;

        $tipAmount = $billAmount * ($tipPercent / 100);
        $total = $billAmount + $tipAmount;
        $perPerson = $total / $peopleCount;

        $result = [
            'tipAmount' => $tipAmount,
            'total' => $total,
            'perPerson' => $perPerson,
        ];
    }
}

/** Escape a value for safe HTML output. */
function e(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

/** Format a number as a currency-style string. */
function money(float $value): string
{
    return '$' . number_format($value, 2);
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tip Calculator</title>
    <style>
        :root {
            color-scheme: light dark;
        }
        body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            max-width: 28rem;
            margin: 3rem auto;
            padding: 0 1rem;
            line-height: 1.5;
        }
        h1 {
            font-size: 1.5rem;
            margin-bottom: 1.5rem;
        }
        form {
            display: grid;
            gap: 1rem;
        }
        label {
            display: grid;
            gap: 0.25rem;
            font-weight: 600;
        }
        input {
            padding: 0.5rem;
            font-size: 1rem;
            border: 1px solid #999;
            border-radius: 0.375rem;
        }
        button {
            padding: 0.6rem 1rem;
            font-size: 1rem;
            font-weight: 600;
            border: none;
            border-radius: 0.375rem;
            background: #2563eb;
            color: #fff;
            cursor: pointer;
        }
        button:hover {
            background: #1d4ed8;
        }
        .errors {
            background: #fee2e2;
            color: #991b1b;
            padding: 0.75rem 1rem;
            border-radius: 0.375rem;
            margin-bottom: 1rem;
        }
        .errors ul {
            margin: 0;
            padding-left: 1.25rem;
        }
        .results {
            margin-top: 2rem;
            padding: 1.25rem;
            border: 1px solid #ccc;
            border-radius: 0.5rem;
        }
        .results h2 {
            margin-top: 0;
            font-size: 1.2rem;
        }
        .results dl {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 0.5rem 1rem;
            margin: 0;
        }
        .results dt {
            font-weight: 600;
        }
        .results dd {
            margin: 0;
            text-align: right;
        }
        .results .grand dt,
        .results .grand dd {
            font-size: 1.25rem;
            color: #2563eb;
        }
    </style>
</head>
<body>
    <h1>Tip Calculator</h1>

    <?php if ($errors): ?>
        <div class="errors">
            <ul>
                <?php foreach ($errors as $error): ?>
                    <li><?= e($error) ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    <?php endif; ?>

    <form method="post" action="">
        <label>
            Bill amount
            <input type="number" name="bill" step="0.01" min="0"
                   placeholder="0.00" value="<?= e($bill) ?>" required>
        </label>
        <label>
            Tip percentage
            <input type="number" name="tip" step="0.1" min="0"
                   placeholder="15" value="<?= e($tip) ?>" required>
        </label>
        <label>
            Number of people
            <input type="number" name="people" step="1" min="1"
                   placeholder="1" value="<?= e($people) ?>" required>
        </label>
        <button type="submit">Calculate</button>
    </form>

    <?php if ($result): ?>
        <div class="results">
            <h2>Results</h2>
            <dl>
                <dt>Tip amount</dt>
                <dd><?= e(money($result['tipAmount'])) ?></dd>
                <dt>Total</dt>
                <dd><?= e(money($result['total'])) ?></dd>
                <div class="grand" style="display: contents;">
                    <dt>Each person owes</dt>
                    <dd><?= e(money($result['perPerson'])) ?></dd>
                </div>
            </dl>
        </div>
    <?php endif; ?>
</body>
</html>
