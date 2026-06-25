<?php
declare(strict_types=1);

$question = 'Which feature should we build next?';
$options = [
    'dark_mode' => 'Dark mode',
    'mobile_app' => 'Mobile app',
    'team_dashboards' => 'Team dashboards',
];

$dataDir = __DIR__ . DIRECTORY_SEPARATOR . 'data';
$voteFile = $dataDir . DIRECTORY_SEPARATOR . 'votes.json';
$message = null;
$error = null;

function defaultVotes(array $options): array
{
    return array_fill_keys(array_keys($options), 0);
}

function loadVotes(string $voteFile, array $options): array
{
    if (!file_exists($voteFile)) {
        return defaultVotes($options);
    }

    $contents = file_get_contents($voteFile);
    $decoded = $contents === false ? null : json_decode($contents, true);
    $votes = defaultVotes($options);

    if (is_array($decoded)) {
        foreach ($votes as $key => $_) {
            $votes[$key] = max(0, (int)($decoded[$key] ?? 0));
        }
    }

    return $votes;
}

function saveVote(string $dataDir, string $voteFile, array $options, string $selected): bool
{
    if (!array_key_exists($selected, $options)) {
        return false;
    }

    if (!is_dir($dataDir) && !mkdir($dataDir, 0775, true) && !is_dir($dataDir)) {
        throw new RuntimeException('Could not create the vote data directory.');
    }

    $handle = fopen($voteFile, 'c+');
    if ($handle === false) {
        throw new RuntimeException('Could not open the vote data file.');
    }

    try {
        if (!flock($handle, LOCK_EX)) {
            throw new RuntimeException('Could not lock the vote data file.');
        }

        rewind($handle);
        $contents = stream_get_contents($handle);
        $decoded = $contents === false || trim($contents) === '' ? [] : json_decode($contents, true);
        $votes = defaultVotes($options);

        if (is_array($decoded)) {
            foreach ($votes as $key => $_) {
                $votes[$key] = max(0, (int)($decoded[$key] ?? 0));
            }
        }

        $votes[$selected]++;

        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, json_encode($votes, JSON_PRETTY_PRINT));
        fflush($handle);
        flock($handle, LOCK_UN);
    } finally {
        fclose($handle);
    }

    return true;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $selected = (string)($_POST['option'] ?? '');

    try {
        if (saveVote($dataDir, $voteFile, $options, $selected)) {
            $message = 'Thanks for voting.';
        } else {
            $error = 'Please choose one of the available options.';
        }
    } catch (RuntimeException $exception) {
        $error = $exception->getMessage();
    }
}

$votes = loadVotes($voteFile, $options);
$totalVotes = array_sum($votes);
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Simple Poll</title>
    <style>
        :root {
            color-scheme: light;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #18212f;
            background: #f3f6f8;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            padding: 32px 16px;
        }

        main {
            width: min(100%, 720px);
            background: #ffffff;
            border: 1px solid #dbe3ea;
            border-radius: 8px;
            box-shadow: 0 18px 60px rgba(24, 33, 47, 0.1);
            padding: 32px;
        }

        h1 {
            margin: 0 0 8px;
            font-size: clamp(1.7rem, 3vw, 2.4rem);
            line-height: 1.1;
        }

        .subtitle {
            margin: 0 0 28px;
            color: #607084;
        }

        fieldset {
            border: 0;
            padding: 0;
            margin: 0;
            display: grid;
            gap: 12px;
        }

        legend {
            margin-bottom: 14px;
            font-weight: 700;
            font-size: 1.08rem;
        }

        label {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px 16px;
            border: 1px solid #ccd7df;
            border-radius: 8px;
            cursor: pointer;
            background: #fbfcfd;
        }

        input[type="radio"] {
            width: 18px;
            height: 18px;
            accent-color: #20736b;
        }

        button {
            margin-top: 18px;
            border: 0;
            border-radius: 8px;
            padding: 13px 18px;
            background: #20736b;
            color: #ffffff;
            font-weight: 700;
            cursor: pointer;
        }

        button:hover {
            background: #185d57;
        }

        .notice,
        .error {
            margin: 0 0 18px;
            padding: 12px 14px;
            border-radius: 8px;
        }

        .notice {
            background: #e8f7ef;
            color: #155b39;
            border: 1px solid #bde4cb;
        }

        .error {
            background: #fff1f0;
            color: #9b201b;
            border: 1px solid #f3c6c3;
        }

        .results {
            margin-top: 32px;
            padding-top: 24px;
            border-top: 1px solid #dbe3ea;
        }

        .result {
            display: grid;
            gap: 8px;
            margin-top: 16px;
        }

        .result-header {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            font-weight: 700;
        }

        .track {
            height: 12px;
            overflow: hidden;
            background: #e8eef2;
            border-radius: 999px;
        }

        .bar {
            height: 100%;
            width: var(--percent);
            background: #e2a63b;
            border-radius: inherit;
        }

        .total {
            margin: 18px 0 0;
            color: #607084;
        }

        @media (max-width: 540px) {
            main {
                padding: 24px;
            }

            .result-header {
                align-items: flex-start;
                flex-direction: column;
                gap: 4px;
            }
        }
    </style>
</head>
<body>
<main>
    <h1>Simple Poll</h1>
    <p class="subtitle">Cast a vote and see the live tally stored on the server.</p>

    <?php if ($message !== null): ?>
        <p class="notice"><?= htmlspecialchars($message, ENT_QUOTES, 'UTF-8') ?></p>
    <?php endif; ?>

    <?php if ($error !== null): ?>
        <p class="error"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></p>
    <?php endif; ?>

    <form method="post">
        <fieldset>
            <legend><?= htmlspecialchars($question, ENT_QUOTES, 'UTF-8') ?></legend>
            <?php foreach ($options as $key => $label): ?>
                <label>
                    <input type="radio" name="option" value="<?= htmlspecialchars($key, ENT_QUOTES, 'UTF-8') ?>" required>
                    <span><?= htmlspecialchars($label, ENT_QUOTES, 'UTF-8') ?></span>
                </label>
            <?php endforeach; ?>
        </fieldset>
        <button type="submit">Submit vote</button>
    </form>

    <section class="results" aria-labelledby="results-heading">
        <h2 id="results-heading">Current tally</h2>
        <?php foreach ($options as $key => $label): ?>
            <?php
            $count = $votes[$key] ?? 0;
            $percent = $totalVotes > 0 ? round(($count / $totalVotes) * 100) : 0;
            ?>
            <div class="result">
                <div class="result-header">
                    <span><?= htmlspecialchars($label, ENT_QUOTES, 'UTF-8') ?></span>
                    <span><?= $count ?> vote<?= $count === 1 ? '' : 's' ?> (<?= $percent ?>%)</span>
                </div>
                <div class="track" aria-hidden="true">
                    <div class="bar" style="--percent: <?= $percent ?>%;"></div>
                </div>
            </div>
        <?php endforeach; ?>
        <p class="total">Total votes: <?= $totalVotes ?></p>
    </section>
</main>
</body>
</html>
