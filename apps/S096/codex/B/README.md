# Secure API Gateway

A Node.js/Express API gateway where developers register, configure a backend URL, generate API keys, and inspect per-key usage on a dashboard. Requests sent to `/gateway/*` with a valid API key are rate-limited and proxied to the developer's configured backend.

## Run locally on port 5096

```bash
npm install
SESSION_SECRET="replace-with-a-long-random-secret" SESSION_COOKIE_SECURE=false npm start
```

Open `http://localhost:5096`, register an account, set a backend URL, then create an API key.

Example proxied request:

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:5096/gateway/api/health
```

The SQLite database is stored at `data/gateway.sqlite` by default. Override with `DATABASE_PATH=/path/to/gateway.sqlite`.

## Security notes

- Passwords are hashed with bcrypt.
- API keys are shown once, then stored only as SHA-256 hashes with a short display prefix.
- SQL access uses prepared, parameterised statements.
- Dashboard state-changing requests require CSRF tokens.
- Session cookies are `HttpOnly`, `SameSite=Strict`, and can be forced secure with `SESSION_COOKIE_SECURE=true`; use that setting behind HTTPS in production.
- Security headers are configured with Helmet, including a restrictive Content Security Policy.
- Error responses avoid stack traces and internal details.
