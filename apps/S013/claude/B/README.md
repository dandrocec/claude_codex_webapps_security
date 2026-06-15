# Visit Counter

A minimal Node.js / Express single-page app that displays how many times the
page has been visited. The count is incremented on each page load and persisted
to a small JSON file (`data/counter.json`) so it survives restarts.

## Requirements

- Node.js 18 or newer (uses `fs/promises` and the built-in `node:` APIs)
- npm

## Run locally on port 5013

```bash
npm install
npm start
```

Then open <http://127.0.0.1:5013>. Each refresh increases the counter, and the
value is written atomically to `data/counter.json`.

The port defaults to `5013`. To override it, set the `PORT` environment variable
(see `.env.example` for all options):

```bash
# macOS / Linux
PORT=5013 npm start

# Windows PowerShell
$env:PORT = "5013"; npm start
```

## Endpoints

| Method | Path         | Description                                   |
| ------ | ------------ | --------------------------------------------- |
| GET    | `/`          | Renders the page and increments the counter.  |
| GET    | `/healthz`   | Read-only JSON health check with the count.   |
| GET    | `/style.css` | Static stylesheet.                            |

## Configuration

All configuration is read from environment variables — nothing secret is
hardcoded. Copy `.env.example` to `.env` for reference (the app reads from the
real process environment; load it with your preferred tool or export manually).

| Variable      | Default               | Purpose                                          |
| ------------- | --------------------- | ------------------------------------------------ |
| `PORT`        | `5013`                | Port to listen on.                               |
| `HOST`        | `127.0.0.1`           | Bind address.                                    |
| `DATA_FILE`   | `./data/counter.json` | Where the counter is persisted.                  |
| `ENABLE_HSTS` | off                   | Set to `1` when served over real HTTPS.          |
| `TRUST_PROXY` | off                   | Set to `1` when behind a trusted reverse proxy.  |

## Security notes (OWASP Top 10)

This app intentionally has no database, no authentication, and no user-supplied
persisted data, so several of the mandated controls have no attack surface here.
The controls that *do* apply are implemented; the others are noted as N/A with
the reason, and the code is written so they would be honoured if the app grew.

**Implemented and applicable:**

- **Security headers (A05):** `helmet` with a strict Content-Security-Policy
  (`default-src 'none'`, no inline scripts), `X-Powered-By` disabled,
  `Referrer-Policy: no-referrer`, frame-ancestors locked down. HSTS is opt-in
  for real HTTPS deployments.
- **XSS / output encoding (A03):** the rendered count is HTML-escaped via a
  context-aware `escapeHtml` helper as defence in depth, and the CSP forbids
  inline and third-party scripts.
- **Input validation (A04):** request bodies are capped to 1 KB; the value read
  back from disk is validated to be a non-negative safe integer before use.
- **No injection surface (A03):** persistence is a plain JSON file written with
  the standard library — there is no SQL, so no SQL string concatenation. If a
  database were added, parameterised/prepared queries would be required.
- **No information leakage (A05/A09):** a centralised error handler returns a
  generic `500` and never sends stack traces or internal details to clients;
  details are logged server-side only.
- **No hardcoded secrets (A05/A07):** all configuration comes from environment
  variables; `.env` is git-ignored and only `.env.example` is committed.
- **Path-traversal safe static serving:** the stylesheet is served from a fixed
  path via `express.static`, which normalises and refuses to escape its root.
- **Safe, durable writes:** counter writes are serialised and atomic
  (temp file + `rename`) to avoid corruption or lost updates under concurrency.

**Not applicable to this app (no such feature exists):**

- **Password hashing (bcrypt/Argon2):** there are no user accounts or passwords.
- **CSRF protection:** there are no authenticated, state-changing requests and no
  session/cookies to forge against. The only write (incrementing on page view)
  is intentional and unauthenticated. If forms or auth were added, CSRF tokens
  and `SameSite`/`HttpOnly`/`Secure` session cookies would be required.
- **Access control / IDOR (A01):** there are no per-user resources to authorise.
- **Secure session cookies:** the app sets no cookies. When sessions are added,
  cookies must be `HttpOnly`, `Secure`, and `SameSite=Lax`/`Strict`.

## Project layout

```
.
├── server.js          # Express app + persistence + security config
├── package.json
├── public/
│   └── style.css
├── data/              # created at runtime; holds counter.json (git-ignored)
├── .env.example
└── README.md
```
