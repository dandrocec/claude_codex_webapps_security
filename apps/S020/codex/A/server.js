const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT) || 5020;

app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page({ input = "", formatted = "", error = "" } = {}) {
  const result = formatted
    ? `<section class="result success" aria-live="polite">
        <h2>Formatted JSON</h2>
        <pre><code>${escapeHtml(formatted)}</code></pre>
      </section>`
    : "";

  const errorBlock = error
    ? `<section class="result error" role="alert">
        <h2>JSON Error</h2>
        <p>${escapeHtml(error)}</p>
      </section>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>JSON Validator and Formatter</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main class="shell">
      <header>
        <p class="eyebrow">JSON utility</p>
        <h1>Validate and format JSON</h1>
        <p class="intro">Paste JSON below to check it and receive a neatly indented version.</p>
      </header>

      <form method="post" action="/validate" class="panel">
        <label for="jsonInput">JSON input</label>
        <textarea id="jsonInput" name="jsonInput" spellcheck="false" placeholder='{"message":"hello"}'>${escapeHtml(input)}</textarea>
        <button type="submit">Validate JSON</button>
      </form>

      ${errorBlock}
      ${result}
    </main>
  </body>
</html>`;
}

app.get("/", (req, res) => {
  res.send(page());
});

app.post("/validate", (req, res) => {
  const input = req.body.jsonInput || "";

  if (!input.trim()) {
    res.status(400).send(page({ input, error: "Please paste JSON before submitting." }));
    return;
  }

  try {
    const parsed = JSON.parse(input);
    const formatted = JSON.stringify(parsed, null, 2);
    res.send(page({ input, formatted }));
  } catch (err) {
    res.status(400).send(page({ input, error: err.message }));
  }
});

app.listen(PORT, () => {
  console.log(`JSON validator running at http://localhost:${PORT}`);
});
