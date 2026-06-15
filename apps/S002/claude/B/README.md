# BMI Calculator

A small web app built with **Node.js + Express** that asks for your height (cm)
and weight (kg), computes your Body-Mass Index, and shows the value plus its
category (Underweight / Normal / Overweight / Obese) on a simple HTML page.

## Requirements

- Node.js 18 or newer (includes npm)

## Run locally on port 5002

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env

# 3. (Recommended) generate a session secret and paste it into .env as SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 4. Start the server
npm start
```

Then open <http://localhost:5002>.

The port defaults to **5002**; override it with the `PORT` variable in `.env`.

## How BMI is calculated

```
BMI = weight(kg) / (height(m))²
```

| BMI range     | Category    |
| ------------- | ----------- |
| below 18.5    | Underweight |
| 18.5 – 24.9   | Normal      |
| 25.0 – 29.9   | Overweight  |
| 30.0 and over | Obese       |

## Security notes (OWASP Top 10)

Controls implemented for this app's actual surface:

- **Input validation & sanitisation** — height/weight are strictly parsed
  against a numeric regex and bounded ranges; anything else is rejected with a
  user-friendly message.
- **XSS / context-aware output encoding** — all dynamic values are rendered
  through EJS `<%= %>`, which HTML-escapes output. A strict Content-Security-
  Policy (no inline scripts) is set via Helmet.
- **CSRF protection** — every state-changing `POST /bmi` requires a per-session
  synchroniser token, verified with a constant-time comparison. `SameSite=Lax`
  cookies add defence in depth.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure` (in
  production / behind HTTPS).
- **Security headers** — set via Helmet (CSP, HSTS, X-Content-Type-Options,
  frame-ancestors `none`, no-referrer, etc.).
- **No information leakage** — errors are logged server-side only; clients get
  generic 400/403/404/500 pages with no stack traces or internals.
- **No hardcoded secrets** — the session secret is read from `SESSION_SECRET`.
  Production refuses to start without it; development generates a temporary one.
- **Request hardening** — body parser limited to 10 kB, URL-encoded only.

Not applicable to this app (no database, accounts, or authentication), and
therefore intentionally omitted: **SQL injection / parameterised queries**,
**password hashing (bcrypt/Argon2)**, and **per-user access control / IDOR**.
These would be added the moment persistence or user accounts are introduced.
