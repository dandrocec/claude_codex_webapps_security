const express = require("express");

const app = express();
const port = process.env.PORT || 5009;
const mappings = new Map();

app.use(express.urlencoded({ extended: false }));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeUrl(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a URL to shorten.");
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withScheme);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  return parsed.toString();
}

function generateCode() {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";

  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (mappings.has(code));

  return code;
}

function renderPage({ error = "", created = null } = {}) {
  const rows = Array.from(mappings.entries())
    .reverse()
    .map(([code, longUrl]) => {
      const shortPath = `/${code}`;
      return `
        <tr>
          <td><a href="${shortPath}">${escapeHtml(code)}</a></td>
          <td><a href="${escapeHtml(longUrl)}">${escapeHtml(longUrl)}</a></td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>URL Shortener</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Arial, Helvetica, sans-serif;
      background: #f5f7fb;
      color: #1f2937;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 48px 16px;
    }

    main {
      width: min(880px, 100%);
      background: #ffffff;
      border: 1px solid #d8dee9;
      border-radius: 8px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
      padding: 28px;
    }

    h1 {
      margin: 0 0 20px;
      font-size: 2rem;
    }

    form {
      display: flex;
      gap: 10px;
      margin-bottom: 18px;
    }

    input[type="url"],
    input[type="text"] {
      flex: 1;
      min-width: 0;
      padding: 12px 14px;
      border: 1px solid #b7c0ce;
      border-radius: 6px;
      font-size: 1rem;
    }

    button {
      border: 0;
      border-radius: 6px;
      background: #2563eb;
      color: #ffffff;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 700;
      padding: 12px 18px;
    }

    .message {
      border-radius: 6px;
      margin-bottom: 18px;
      padding: 12px 14px;
    }

    .success {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #065f46;
    }

    .error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #991b1b;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    th,
    td {
      border-bottom: 1px solid #e5e7eb;
      padding: 12px 8px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }

    th:first-child,
    td:first-child {
      width: 140px;
    }

    .empty {
      color: #6b7280;
      margin: 0;
    }

    @media (max-width: 640px) {
      body {
        padding: 20px 10px;
      }

      main {
        padding: 20px;
      }

      form {
        flex-direction: column;
      }

      button {
        width: 100%;
      }
    }

    @media (prefers-color-scheme: dark) {
      :root {
        background: #111827;
        color: #e5e7eb;
      }

      main {
        background: #1f2937;
        border-color: #374151;
      }

      input[type="url"],
      input[type="text"] {
        background: #111827;
        border-color: #4b5563;
        color: #f9fafb;
      }

      th,
      td {
        border-bottom-color: #374151;
      }

      a {
        color: #93c5fd;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>URL Shortener</h1>
    <form method="post" action="/shorten">
      <input type="text" name="longUrl" placeholder="https://example.com/long/path" aria-label="Long URL" required>
      <button type="submit">Shorten</button>
    </form>
    ${
      error
        ? `<div class="message error">${escapeHtml(error)}</div>`
        : ""
    }
    ${
      created
        ? `<div class="message success">Created short URL: <a href="/${escapeHtml(created.code)}">/${escapeHtml(created.code)}</a></div>`
        : ""
    }
    <h2>Created this session</h2>
    ${
      rows
        ? `<table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Original URL</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`
        : `<p class="empty">No URLs have been shortened yet.</p>`
    }
  </main>
</body>
</html>`;
}

app.get("/", (req, res) => {
  res.send(renderPage());
});

app.post("/shorten", (req, res) => {
  try {
    const longUrl = normalizeUrl(req.body.longUrl || "");
    const existing = Array.from(mappings.entries()).find(([, savedUrl]) => savedUrl === longUrl);
    const code = existing ? existing[0] : generateCode();

    if (!existing) {
      mappings.set(code, longUrl);
    }

    res.send(renderPage({ created: { code, longUrl } }));
  } catch (error) {
    res.status(400).send(renderPage({ error: error.message }));
  }
});

app.get("/:code", (req, res) => {
  const longUrl = mappings.get(req.params.code);

  if (!longUrl) {
    res.status(404).send(renderPage({ error: `No URL found for code "${req.params.code}".` }));
    return;
  }

  res.redirect(longUrl);
});

app.listen(port, () => {
  console.log(`URL shortener listening on http://localhost:${port}`);
});
