const express = require("express");

const app = express();
const PORT = process.env.PORT || 5024;

const redirects = new Map();

app.use(express.urlencoded({ extended: false }));

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isValidKey(key) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(key);
}

function isValidDestination(destination) {
  try {
    const parsed = new URL(destination);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function renderPage({ error = "", message = "" } = {}) {
  const rows = Array.from(redirects.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, destination]) => {
      const safeKey = escapeHtml(key);
      const safeDestination = escapeHtml(destination);
      const goUrl = `/go?to=${encodeURIComponent(key)}`;

      return `
        <tr>
          <td><code>${safeKey}</code></td>
          <td><a href="${safeDestination}" rel="noreferrer">${safeDestination}</a></td>
          <td><a class="button secondary" href="${goUrl}">Open</a></td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Redirect Registry</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, Helvetica, sans-serif;
      color: #1f2937;
      background: #f7f7f4;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 32px;
    }

    main {
      width: min(980px, 100%);
      margin: 0 auto;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 32px;
      line-height: 1.15;
    }

    p {
      margin: 0;
      color: #4b5563;
      line-height: 1.5;
    }

    .panel {
      margin-top: 24px;
      padding: 24px;
      background: #ffffff;
      border: 1px solid #d9d9d2;
      border-radius: 8px;
      box-shadow: 0 12px 28px rgba(31, 41, 55, 0.08);
    }

    form {
      display: grid;
      grid-template-columns: minmax(160px, 220px) 1fr auto;
      gap: 16px;
      align-items: end;
    }

    label {
      display: grid;
      gap: 6px;
      font-weight: 700;
      color: #374151;
    }

    input {
      width: 100%;
      min-height: 42px;
      padding: 10px 12px;
      font: inherit;
      border: 1px solid #b8b8ad;
      border-radius: 6px;
      background: #ffffff;
    }

    input:focus {
      outline: 3px solid rgba(37, 99, 235, 0.22);
      border-color: #2563eb;
    }

    button,
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 10px 14px;
      border: 0;
      border-radius: 6px;
      background: #2563eb;
      color: #ffffff;
      font: inherit;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      white-space: nowrap;
    }

    .button.secondary {
      background: #e5e7eb;
      color: #111827;
    }

    .notice {
      margin-top: 16px;
      padding: 12px 14px;
      border-radius: 6px;
      border: 1px solid #bfdbfe;
      background: #eff6ff;
      color: #1e3a8a;
    }

    .error {
      border-color: #fecaca;
      background: #fef2f2;
      color: #991b1b;
    }

    table {
      width: 100%;
      margin-top: 18px;
      border-collapse: collapse;
      background: #ffffff;
      overflow-wrap: anywhere;
    }

    th,
    td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: middle;
    }

    th {
      color: #374151;
      font-size: 14px;
      text-transform: uppercase;
    }

    code {
      font-family: Consolas, Monaco, monospace;
      background: #f3f4f6;
      padding: 2px 5px;
      border-radius: 4px;
    }

    .empty {
      margin-top: 16px;
      padding: 18px;
      border: 1px dashed #b8b8ad;
      border-radius: 8px;
      color: #4b5563;
      background: #fbfbf9;
    }

    @media (max-width: 760px) {
      body {
        padding: 20px;
      }

      form {
        grid-template-columns: 1fr;
      }

      table,
      thead,
      tbody,
      tr,
      th,
      td {
        display: block;
      }

      thead {
        display: none;
      }

      tr {
        padding: 12px 0;
        border-bottom: 1px solid #e5e7eb;
      }

      td {
        border: 0;
        padding: 6px 0;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>Redirect Registry</h1>
    <p>Register a short key with an HTTP or HTTPS destination, then redirect visitors through <code>/go?to=&lt;key&gt;</code>.</p>

    <section class="panel">
      <form method="post" action="/redirects">
        <label>
          Key
          <input name="key" placeholder="docs" autocomplete="off" required maxlength="64" pattern="[A-Za-z0-9_-]+">
        </label>
        <label>
          Destination URL
          <input name="destination" placeholder="https://example.com/docs" type="url" required>
        </label>
        <button type="submit">Register</button>
      </form>

      ${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ""}
      ${message ? `<div class="notice">${escapeHtml(message)}</div>` : ""}
    </section>

    <section class="panel">
      <h2>Registered Redirects</h2>
      ${
        rows
          ? `<table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Destination</th>
                  <th>Test</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>`
          : `<div class="empty">No redirects have been registered yet.</div>`
      }
    </section>
  </main>
</body>
</html>`;
}

app.get("/", (req, res) => {
  res.send(renderPage({
    error: req.query.error || "",
    message: req.query.message || ""
  }));
});

app.post("/redirects", (req, res) => {
  const key = String(req.body.key || "").trim();
  const destination = String(req.body.destination || "").trim();

  if (!isValidKey(key)) {
    return res.redirect("/?error=Keys%20may%20only%20use%20letters%2C%20numbers%2C%20underscores%2C%20and%20hyphens.");
  }

  if (!isValidDestination(destination)) {
    return res.redirect("/?error=Destination%20must%20be%20a%20valid%20HTTP%20or%20HTTPS%20URL.");
  }

  redirects.set(key, destination);
  return res.redirect(`/?message=${encodeURIComponent(`Redirect "${key}" saved.`)}`);
});

app.get("/go", (req, res) => {
  const key = String(req.query.to || "").trim();
  const destination = redirects.get(key);

  if (!destination) {
    return res.status(404).send(renderPage({ error: `No redirect found for "${key || "blank"}".` }));
  }

  return res.redirect(destination);
});

app.listen(PORT, () => {
  console.log(`Redirect Registry listening on http://localhost:${PORT}`);
});
