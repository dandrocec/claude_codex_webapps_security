<?php
$input = '';
$direction = 'encode';
$result = null;
$error = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = isset($_POST['text']) ? (string) $_POST['text'] : '';
    $direction = isset($_POST['direction']) ? (string) $_POST['direction'] : 'encode';

    if ($direction === 'encode') {
        $result = base64_encode($input);
    } elseif ($direction === 'decode') {
        $decoded = base64_decode($input, true);

        if ($decoded === false) {
            $error = 'The submitted text is not valid Base64.';
        } else {
            $result = $decoded;
        }
    } else {
        $error = 'Choose a valid direction.';
        $direction = 'encode';
    }
}

function h(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Base64 Encoder Decoder</title>
    <style>
        :root {
            color-scheme: light;
            --bg: #f6f7f9;
            --panel: #ffffff;
            --text: #17202a;
            --muted: #5f6b7a;
            --border: #d8dee7;
            --accent: #1769aa;
            --accent-dark: #0f4f82;
            --danger-bg: #fff1f0;
            --danger-text: #9f1d1d;
            --result-bg: #f1f8f4;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            background: var(--bg);
            color: var(--text);
            font-family: Arial, Helvetica, sans-serif;
            line-height: 1.5;
            display: grid;
            place-items: center;
            padding: 32px 16px;
        }

        main {
            width: min(760px, 100%);
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 28px;
            box-shadow: 0 12px 30px rgba(23, 32, 42, 0.08);
        }

        h1 {
            margin: 0 0 8px;
            font-size: 28px;
            line-height: 1.2;
        }

        p {
            margin: 0 0 24px;
            color: var(--muted);
        }

        label,
        legend {
            display: block;
            margin-bottom: 8px;
            font-weight: 700;
        }

        textarea {
            width: 100%;
            min-height: 180px;
            resize: vertical;
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 12px;
            color: var(--text);
            font: 15px/1.45 Consolas, Monaco, monospace;
        }

        textarea:focus,
        input:focus {
            outline: 3px solid rgba(23, 105, 170, 0.18);
            border-color: var(--accent);
        }

        fieldset {
            border: 0;
            padding: 0;
            margin: 18px 0;
        }

        .choices {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }

        .choice {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 10px 12px;
            cursor: pointer;
            font-weight: 600;
        }

        .choice input {
            accent-color: var(--accent);
        }

        button {
            border: 0;
            border-radius: 6px;
            background: var(--accent);
            color: #ffffff;
            cursor: pointer;
            font-weight: 700;
            padding: 12px 18px;
            min-width: 128px;
        }

        button:hover {
            background: var(--accent-dark);
        }

        .message {
            margin-top: 24px;
            border-radius: 6px;
            padding: 16px;
            border: 1px solid var(--border);
        }

        .error {
            background: var(--danger-bg);
            color: var(--danger-text);
            border-color: #f0b8b8;
        }

        .result {
            background: var(--result-bg);
        }

        .result pre {
            margin: 8px 0 0;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
            font: 15px/1.45 Consolas, Monaco, monospace;
        }

        @media (max-width: 520px) {
            main {
                padding: 22px;
            }

            h1 {
                font-size: 24px;
            }

            .choices {
                display: grid;
            }

            button {
                width: 100%;
            }
        }
    </style>
</head>
<body>
    <main>
        <h1>Base64 Tool</h1>
        <p>Encode plain text to Base64 or decode Base64 back to text.</p>

        <form method="post" action="">
            <label for="text">Text</label>
            <textarea id="text" name="text" required><?= h($input) ?></textarea>

            <fieldset>
                <legend>Direction</legend>
                <div class="choices">
                    <label class="choice">
                        <input type="radio" name="direction" value="encode" <?= $direction === 'encode' ? 'checked' : '' ?>>
                        Encode
                    </label>
                    <label class="choice">
                        <input type="radio" name="direction" value="decode" <?= $direction === 'decode' ? 'checked' : '' ?>>
                        Decode
                    </label>
                </div>
            </fieldset>

            <button type="submit">Convert</button>
        </form>

        <?php if ($error !== null): ?>
            <section class="message error" role="alert">
                <?= h($error) ?>
            </section>
        <?php elseif ($result !== null): ?>
            <section class="message result" aria-live="polite">
                <strong>Result</strong>
                <pre><?= h($result) ?></pre>
            </section>
        <?php endif; ?>
    </main>
</body>
</html>
