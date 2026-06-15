# URL Shortener

A minimal URL shortener built with Node.js and Express. Submit a long URL through
the form and get back a short code; visiting `/<code>` redirects to the original
link. All mappings are stored **in memory**, so they reset every time the server
restarts. The home page lists every code created since the server started.

## Requirements

- Node.js 18 or newer (uses the built-in `URL` and `base64url` support)

## Run it locally

```bash
npm install
npm start
```

Then open <http://localhost:5009> in your browser.

To run on a different port:

```bash
# macOS / Linux
PORT=8080 npm start

# Windows (PowerShell)
$env:PORT=8080; npm start
```

## How it works

- `POST /shorten` — accepts a form field `url`, validates it as an http(s) link,
  generates a random 6-character code, and stores `code -> url` in a `Map`.
- `GET /:code` — looks up the code and issues a 302 redirect, or returns 404.
- `GET /` — renders the form plus a table of all codes created this session.

No database required — the store lives only for the lifetime of the process.
