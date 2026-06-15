# Calc API

A tiny, security-hardened JSON API that evaluates arithmetic expressions, plus
a minimal web page that talks to it.

- `POST /calc` — accepts `{ "expression": "2 + 3 * 4" }`, returns `{ "result": 14 }`
- `GET /` — an HTML page that posts to the endpoint and shows the answer

Supported operators: `+ - * / %`, exponentiation `^`, parentheses, unary
minus/plus, decimals and scientific notation (e.g. `1.5e3`).

## Run it locally (port 5022)

Requires Node.js 18+.

```bash
npm install
npm start
```

Then open <http://localhost:5022>.

Configuration is via environment variables (see `.env.example`). To use a
different port:

```bash
# macOS / Linux
PORT=5022 npm start

# Windows PowerShell
$env:PORT=5022; npm start
```

## API usage

The endpoint is CSRF-protected, so calling it directly requires the matching
token from the `csrfToken` cookie echoed in the `X-CSRF-Token` header. The
easiest way to exercise it is through the web page. With `curl`:

```bash
# 1. Fetch the page to obtain a signed CSRF cookie + token.
curl -c jar.txt -s http://localhost:5022/ | grep csrf-token
#    -> <meta name="csrf-token" content="<TOKEN>">

# 2. Call the endpoint with the cookie jar and the token header.
curl -b jar.txt -s http://localhost:5022/calc \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <TOKEN>' \
  -d '{"expression":"2 + 3 * 4"}'
# -> {"result":14}
```

## Security notes

This service has no database, user accounts, or sessions, so the SQL-injection,
password-hashing, and per-user access-control (IDOR) requirements have no
attack surface here. Everything applicable is implemented:

- **No code execution / safe evaluation** — expressions are tokenised against a
  strict character whitelist and parsed with a hand-written recursive-descent
  parser in `evaluator.js`. `eval`, `Function`, and `vm` are never used, so
  injecting code, reaching globals, or prototype pollution is impossible.
- **Input validation & sanitisation** — type check, length cap (256 chars),
  character whitelist, JSON body size limit (2 KB), and `maxlength` on the form.
- **Output encoding / XSS** — the client renders results with `textContent`
  (never `innerHTML`); the server HTML-escapes the only value it interpolates;
  a strict `Content-Security-Policy` (no inline scripts) backstops both.
- **CSRF protection** — signed double-submit cookie. The token lives in an
  HttpOnly, signed cookie and must be echoed in the `X-CSRF-Token` header;
  verified with a timing-safe comparison.
- **Secure cookies** — `HttpOnly`, `SameSite=Strict`, and `Secure` in
  production.
- **Security headers** — set via Helmet (CSP, `X-Content-Type-Options`,
  `Referrer-Policy: no-referrer`, frame-ancestors denied, `x-powered-by` off).
- **No leaked internals** — a central error handler returns a generic 500;
  stack traces are logged server-side only.
- **No hardcoded secrets** — `COOKIE_SECRET` is read from the environment and
  is mandatory in production.
- **Rate limiting** — 120 requests/minute/IP to blunt abuse.

## Project layout

```
server.js        Express app: routing, security middleware, CSRF, error handling
evaluator.js     Safe expression tokeniser + recursive-descent parser
public/app.js    Client: posts to /calc, renders the result safely
public/style.css Styling
```
