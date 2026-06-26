# Secure Crowdfunding Express App

A Node.js/Express crowdfunding site where creators launch campaigns and backers pledge money. Campaign pages show total raised, pledge count, and progress toward the goal. Data is stored in SQLite.

## Run locally on port 5069

```bash
npm install
SESSION_SECRET="replace-with-at-least-32-random-characters" SESSION_COOKIE_SECURE=false PORT=5069 npm start
```

Open `http://localhost:5069`.

For production, serve behind HTTPS and set `SESSION_COOKIE_SECURE=true`.

## Security notes

- All SQL uses parameterized prepared statements.
- Passwords are salted and hashed with bcrypt.
- Inputs are validated server-side and EJS context escaping is used for rendered output.
- CSRF protection is applied to all state-changing forms.
- Campaign deletion checks resource ownership to prevent IDOR.
- Sessions use HttpOnly, SameSite cookies and support Secure cookies for HTTPS deployments.
- Helmet sets security headers and errors return generic pages without stack traces.
- Secrets are read from environment variables.
