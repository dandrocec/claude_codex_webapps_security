<?php
declare(strict_types=1);

$billAmountInput = $_POST['bill_amount'] ?? '';
$tipPercentageInput = $_POST['tip_percentage'] ?? '20';
$peopleInput = $_POST['people'] ?? '1';
$errors = [];
$result = null;

function money(float $amount): string
{
    return '$' . number_format($amount, 2);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $billAmount = filter_var($billAmountInput, FILTER_VALIDATE_FLOAT);
    $tipPercentage = filter_var($tipPercentageInput, FILTER_VALIDATE_FLOAT);
    $people = filter_var($peopleInput, FILTER_VALIDATE_INT);

    if ($billAmount === false || $billAmount < 0) {
        $errors[] = 'Enter a valid bill amount of 0 or more.';
    }

    if ($tipPercentage === false || $tipPercentage < 0) {
        $errors[] = 'Enter a valid tip percentage of 0 or more.';
    }

    if ($people === false || $people < 1) {
        $errors[] = 'Enter at least 1 person.';
    }

    if ($errors === []) {
        $tipAmount = $billAmount * ($tipPercentage / 100);
        $total = $billAmount + $tipAmount;
        $perPerson = $total / $people;

        $result = [
            'tip_amount' => $tipAmount,
            'total' => $total,
            'per_person' => $perPerson,
        ];
    }
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Tip Splitter</title>
    <style>
        :root {
            color-scheme: light;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #172126;
            background: #f5f7f4;
        }

        * {
            box-sizing: border-box;
        }

        body {
            min-height: 100vh;
            margin: 0;
            display: grid;
            place-items: center;
            padding: 32px 16px;
        }

        main {
            width: min(100%, 720px);
        }

        h1 {
            margin: 0 0 8px;
            font-size: clamp(2rem, 5vw, 3.5rem);
            line-height: 1;
            letter-spacing: 0;
        }

        p {
            margin: 0;
            color: #526066;
        }

        .layout {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(240px, 0.8fr);
            gap: 18px;
            margin-top: 28px;
        }

        .panel {
            background: #ffffff;
            border: 1px solid #dfe6df;
            border-radius: 8px;
            box-shadow: 0 16px 36px rgba(31, 45, 50, 0.08);
            padding: 22px;
        }

        form {
            display: grid;
            gap: 16px;
        }

        label {
            display: grid;
            gap: 7px;
            font-weight: 700;
        }

        input {
            width: 100%;
            border: 1px solid #bac6bf;
            border-radius: 6px;
            padding: 12px 13px;
            font: inherit;
            color: #172126;
            background: #fbfcfb;
        }

        input:focus {
            outline: 3px solid rgba(48, 126, 96, 0.18);
            border-color: #307e60;
        }

        button {
            min-height: 46px;
            border: 0;
            border-radius: 6px;
            padding: 0 18px;
            font: inherit;
            font-weight: 800;
            color: #ffffff;
            background: #307e60;
            cursor: pointer;
        }

        button:hover {
            background: #24694f;
        }

        .errors {
            display: grid;
            gap: 8px;
            margin-bottom: 16px;
            color: #8f1d2c;
            font-weight: 700;
        }

        .results {
            display: grid;
            gap: 14px;
        }

        .result-row {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 16px;
            padding-bottom: 14px;
            border-bottom: 1px solid #e7ece7;
        }

        .result-row:last-child {
            border-bottom: 0;
            padding-bottom: 0;
        }

        .result-label {
            color: #526066;
            font-weight: 700;
        }

        .result-value {
            font-size: 1.45rem;
            font-weight: 900;
            white-space: nowrap;
        }

        .empty-state {
            min-height: 100%;
            display: grid;
            align-content: center;
            gap: 10px;
            color: #526066;
        }

        @media (max-width: 680px) {
            body {
                place-items: start center;
                padding: 22px 14px;
            }

            .layout {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <main>
        <h1>Tip Splitter</h1>
        <p>Calculate the tip, total, and per-person amount for a shared bill.</p>

        <div class="layout">
            <section class="panel" aria-labelledby="form-heading">
                <h2 id="form-heading" hidden>Bill details</h2>

                <?php if ($errors !== []): ?>
                    <div class="errors" role="alert">
                        <?php foreach ($errors as $error): ?>
                            <div><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>

                <form method="post" action="/">
                    <label>
                        Bill amount
                        <input
                            type="number"
                            name="bill_amount"
                            min="0"
                            step="0.01"
                            required
                            value="<?= htmlspecialchars((string) $billAmountInput, ENT_QUOTES, 'UTF-8') ?>"
                        >
                    </label>

                    <label>
                        Tip percentage
                        <input
                            type="number"
                            name="tip_percentage"
                            min="0"
                            step="0.01"
                            required
                            value="<?= htmlspecialchars((string) $tipPercentageInput, ENT_QUOTES, 'UTF-8') ?>"
                        >
                    </label>

                    <label>
                        Number of people
                        <input
                            type="number"
                            name="people"
                            min="1"
                            step="1"
                            required
                            value="<?= htmlspecialchars((string) $peopleInput, ENT_QUOTES, 'UTF-8') ?>"
                        >
                    </label>

                    <button type="submit">Calculate</button>
                </form>
            </section>

            <section class="panel" aria-labelledby="results-heading">
                <h2 id="results-heading" hidden>Results</h2>

                <?php if ($result !== null): ?>
                    <div class="results">
                        <div class="result-row">
                            <span class="result-label">Tip amount</span>
                            <span class="result-value"><?= money($result['tip_amount']) ?></span>
                        </div>
                        <div class="result-row">
                            <span class="result-label">Total</span>
                            <span class="result-value"><?= money($result['total']) ?></span>
                        </div>
                        <div class="result-row">
                            <span class="result-label">Each person owes</span>
                            <span class="result-value"><?= money($result['per_person']) ?></span>
                        </div>
                    </div>
                <?php else: ?>
                    <div class="empty-state">
                        <strong>Results will appear here.</strong>
                        <span>Submit the form to split the bill.</span>
                    </div>
                <?php endif; ?>
            </section>
        </div>
    </main>
</body>
</html>
