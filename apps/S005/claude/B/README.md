# Markdown Preview

A small, security-hardened Node.js/Express web app. Paste Markdown into the
textarea, click **Render**, and the sanitised HTML preview appears below on the
same page.

## Requirements

- Node.js 18 or newer (tested on Node 24)
- npm

## Run locally on port 5005

```bash
# 1. Install dependencies
npm install

# 2. (Recommended) provide a session secret
#    Copy the example env file and fill in SESSION_SECRET.
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#    paste the output into SESSION_SECRET= in .env, then load it however you
#    prefer. The simplest cross-platform option:

# 3. Start the app (defaults to port 5005)
npm start
```

Then open <http://localhost:5005>.

> In **development** the app runs without `SESSION_SECRET` (it generates a
> temporary one and prints a warning). In **production** (`NODE_ENV=production`)
> `SESSION_SECRET` is **mandatory** and the app exits if it is missing.

### Setting environment variables

This project reads configuration from real environment variables (it does not
auto-load `.env`, to avoid an extra dependency). Set them in your shell:

PowerShell (Windows):

```powershell
$env:SESSION_SECRET = "<your-32-byte-hex-secret>"
$env:PORT = "5005"
npm start
```

bash/zsh (macOS/Linux):

```bash
SESSION_SECRET="<your-32-byte-hex-secret>" PORT=5005 npm start
```

## How it works

- `GET /` serves the page with the input form and a CSRF token.
- `POST /render` validates the request, converts Markdown to HTML with
  [`marked`](https://github.com/markedjs/marked), **sanitises** it with
  [`DOMPurify`](https://github.com/cure53/DOMPurify), and re-renders the page
  with the safe HTML embedded below the textarea.

## Security measures (OWASP Top 10)

The core risk in a Markdown previewer is **stored/reflected XSS**, because
Markdown can contain raw HTML and `<script>`. Each measure below maps to the
mandated requirements:

| Requirement | Implementation |
|---|---|
| **XSS — input/output handling** | Untrusted Markdown is rendered, then passed through **DOMPurify** before being embedded. The re-displayed raw input uses EJS `<%= %>` (HTML-escaped). Only the already-sanitised preview uses `<%- %>`. |
| **Security headers / CSP** | [`helmet`](https://helmetjs.github.io/) sets a strict `Content-Security-Policy` (`default-src 'self'`, `object-src 'none'`, no inline scripts/styles, `frame-ancestors 'none'`), HSTS, `X-Content-Type-Options`, no-referrer, etc. `x-powered-by` is disabled. |
| **CSRF protection** | Synchronizer-token pattern: a per-session random token is embedded in the form and verified on every state-changing `POST` using a constant-time comparison. |
| **Secure session cookies** | `express-session` cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Cookie name is generic (`sid`). |
| **No secret leakage** | `SESSION_SECRET` and other config come from environment variables; nothing is hardcoded. |
| **Error handling** | A central error handler logs details server-side and returns only a generic message — no stack traces or internals reach the client. |
| **Input validation / DoS limits** | Request body size is capped (256 KB) and Markdown input is limited to 100 KB; a rate limiter caps `/render` to 60 requests/minute per IP. |

### Requirements that do not apply to this app

The task also lists database- and account-related controls. **This app has no
database and no user accounts**, so there is nothing to attack via those
vectors:

- **SQL injection / parameterised queries** — N/A: no database is used. If one
  were added, all queries would use parameterised statements / prepared
  queries (never string concatenation).
- **Password hashing (bcrypt/Argon2)** — N/A: no authentication or stored
  credentials. If added, passwords would be hashed with Argon2id (or bcrypt).
- **Access control / IDOR** — N/A: there are no per-user resources to access;
  every render is stateless and scoped to the requester's own input. If
  user-owned resources were added, every request would be authorised against
  the authenticated owner.

These are documented here for completeness and to show the intended approach
should the app grow.

## Project layout

```
.
├── server.js          # Express app, security middleware, routes
├── views/index.ejs    # Single page: form + rendered output
├── public/style.css   # Styles (served from same origin to satisfy CSP)
├── package.json
├── .env.example
└── README.md
```
