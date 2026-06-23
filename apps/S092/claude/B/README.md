# Clinic Portal

A secure clinic portal built with **Node.js + Express**, **EJS** templates, and a
**SQLite** database. Three roles, each with strictly scoped access:

| Role           | Can do                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **Patient**    | Book appointments with their assigned doctor; view their own records & appointments. |
| **Doctor**     | View/add/update medical records for *their own* patients; view their appointments. |
| **Receptionist** | Manage the whole schedule: create appointments and change their status. |

## Requirements

- Node.js 18 or newer (tested on Node 24)
- npm

## Run it locally (port 5092)

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file from the template
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env

# 3. Put a real secret in .env (SESSION_SECRET). Generate one with:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#    Paste the output as SESSION_SECRET=... in .env

# 4. Create the database schema and demo data
npm run seed

# 5. Start the server
npm start
```

Open <http://localhost:5092>. The port is controlled by `PORT` in `.env` (defaults to 5092).

### Demo accounts

Created by `npm run seed`. **Password for every account: `Password123!`**

| Username   | Role         | Notes                          |
| ---------- | ------------ | ------------------------------ |
| `dr.house` | doctor       | Alice is assigned to him       |
| `dr.grey`  | doctor       | Bob is assigned to her         |
| `reception`| receptionist | Manages the schedule           |
| `alice`    | patient      | Assigned to Dr. House          |
| `bob`      | patient      | Assigned to Dr. Grey           |

New patients can self-register at `/register`; staff accounts are provisioned via the seed.

## Project layout

```
src/
  server.js          # entry point, env validation
  app.js             # express app: security middleware, sessions, routing
  db.js              # SQLite connection + schema
  seed.js            # demo data
  middleware/
    auth.js          # requireAuth / requireRole (access control)
    csrf.js          # synchroniser-token CSRF protection
  routes/
    auth.js          # register / login / logout
    patient.js       # patient: own appointments + records
    doctor.js        # doctor: their patients' records
    reception.js     # receptionist: schedule management
  views/             # EJS templates (auto-escaped output)
public/styles.css
```

## Security measures (OWASP Top 10)

- **A01 Broken Access Control / IDOR** — every query is scoped to the session user.
  Patients read/write only rows where `patient_id = session.user.id`; doctors only
  reach patients where `doctor_id = session.user.id`; resource ids from the URL are
  re-checked against ownership, never trusted. Role gates via `requireRole`.
- **A02 Cryptographic Failures** — passwords hashed with **bcrypt** (cost 12, salted).
  Session secret and cookie flags come from environment variables.
- **A03 Injection (SQLi)** — **all** database access uses `better-sqlite3` prepared
  statements with bound parameters; no string concatenation of user input.
- **XSS** — EJS `<%= %>` applies context-aware HTML escaping to every value rendered;
  a strict **Content-Security-Policy** (via Helmet) blocks inline scripts.
- **CSRF** — synchroniser token tied to the session is required on every
  POST/PUT/PATCH/DELETE and compared in constant time; `SameSite=Lax` cookie adds defence in depth.
- **A05 Security Misconfiguration** — **Helmet** sets HSTS, `X-Content-Type-Options`,
  frameguard, CSP, referrer-policy, etc. Body size is capped.
- **A07 Identification & Auth Failures** — input validation on all forms
  (`express-validator`), rate limiting on auth endpoints, session regeneration on login
  (anti-fixation), generic login errors to limit user enumeration.
- **Secure session cookies** — `HttpOnly`, `SameSite=Lax`, and `Secure`
  (enable via `COOKIE_SECURE=true` when served over HTTPS).
- **No information leakage** — a centralised error handler logs details server-side and
  returns a generic message; stack traces are never sent to clients.
- **No hardcoded secrets** — `SESSION_SECRET` is required at startup; the app refuses to
  boot without it.

## Notes

- Sessions are persisted in `data/sessions.db` (SQLite), so they survive restarts.
- Over plain HTTP on localhost keep `COOKIE_SECURE=false`; set it to `true` only behind HTTPS.
- This is a demonstration app — do not use it with real patient data.
```
