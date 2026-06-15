# JSON Validator & Formatter

A tiny Node.js/Express web app. Paste JSON into a textarea and submit; the app
either pretty-prints it with 2-space indentation or shows an error message that
describes what's wrong (including line/column when available).

## Requirements

- Node.js 16 or newer (includes npm)

## Run locally

```bash
npm install
npm start
```

Then open <http://localhost:5020> in your browser.

The port is hard-coded to **5020**, but you can override it:

```bash
# macOS / Linux
PORT=5020 npm start

# Windows (PowerShell)
$env:PORT=5020; npm start
```

## How it works

- `GET /` serves the page with the input form.
- `POST /` reads the pasted text, runs it through `JSON.parse`:
  - on success, it returns `JSON.stringify(value, null, 2)` (neat indentation);
  - on failure, it returns the parser's error message, augmented with a
    `(line, column)` hint computed from the error position.

All input is HTML-escaped before being echoed back, so pasted content can't
inject markup into the page.

## Files

- `server.js` — the Express server and HTML rendering.
- `package.json` — dependency manifest (`express`) and the `start` script.
