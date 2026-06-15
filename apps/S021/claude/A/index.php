<?php
declare(strict_types=1);

$text      = '';
$direction = 'encode';
$result    = null;
$error     = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $text      = (string) ($_POST['text'] ?? '');
    $direction = ($_POST['direction'] ?? 'encode') === 'decode' ? 'decode' : 'encode';

    if ($text === '') {
        $error = 'Please enter some text.';
    } elseif ($direction === 'encode') {
        $result = base64_encode($text);
    } else {
        // strict mode: returns false on invalid Base64 input
        $decoded = base64_decode($text, true);
        if ($decoded === false) {
            $error = 'Input is not valid Base64.';
        } else {
            $result = $decoded;
        }
    }
}

/** Escape helper for safe HTML output. */
function e(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Base64 Encoder / Decoder</title>
    <style>
        :root { color-scheme: light dark; }
        * { box-sizing: border-box; }
        body {
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            max-width: 640px;
            margin: 3rem auto;
            padding: 0 1rem;
            line-height: 1.5;
        }
        h1 { font-size: 1.5rem; }
        textarea {
            width: 100%;
            min-height: 8rem;
            padding: .6rem;
            font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
            font-size: .95rem;
            resize: vertical;
        }
        fieldset { border: 1px solid #8884; border-radius: 8px; margin: 1rem 0; }
        label { margin-right: 1.25rem; cursor: pointer; }
        button {
            padding: .6rem 1.4rem;
            font-size: 1rem;
            cursor: pointer;
            border: 0;
            border-radius: 8px;
            background: #2563eb;
            color: #fff;
        }
        button:hover { background: #1d4ed8; }
        .result, .error {
            margin-top: 1.5rem;
            padding: 1rem;
            border-radius: 8px;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .result {
            background: #16a34a22;
            border: 1px solid #16a34a66;
            font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
        }
        .error { background: #dc262622; border: 1px solid #dc262666; }
        .result h2 { font-size: 1rem; margin: 0 0 .5rem; }
    </style>
</head>
<body>
    <h1>Base64 Encoder / Decoder</h1>

    <form method="post" action="">
        <label for="text"><strong>Text</strong></label>
        <textarea id="text" name="text" placeholder="Enter text to encode or decode..."><?= e($text) ?></textarea>

        <fieldset>
            <legend>Direction</legend>
            <label>
                <input type="radio" name="direction" value="encode" <?= $direction === 'encode' ? 'checked' : '' ?>>
                Encode
            </label>
            <label>
                <input type="radio" name="direction" value="decode" <?= $direction === 'decode' ? 'checked' : '' ?>>
                Decode
            </label>
        </fieldset>

        <button type="submit">Convert</button>
    </form>

<?php if ($error !== null): ?>
    <div class="error"><?= e($error) ?></div>
<?php elseif ($result !== null): ?>
    <div class="result">
        <h2><?= $direction === 'encode' ? 'Encoded' : 'Decoded' ?> result</h2>
        <?= e($result) ?>
    </div>
<?php endif; ?>
</body>
</html>
