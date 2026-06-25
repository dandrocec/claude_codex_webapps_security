# Secure Express URL Shortener

A small Node.js/Express URL shortener that stores URL mappings in memory for the current server process. Users can create short codes, visit `/<code>` to redirect, and see the codes created in their current browser session.

## Run locally on port 5009

```bash
npm install
SESSION_SECRET="replace-with-a-long-random-secret" PORT=5009 npm start
```

Then open `http://localhost:5009`.

For HTTPS deployments, also set:

```bash
NODE_ENV=production SESSION_COOKIE_SECURE=true TRUST_PROXY=true
```

## Security notes

- URL input is validated and limited to `http` and `https` URLs without embedded credentials.
- Form submissions use CSRF protection.
- Output is rendered with EJS escaped values to reduce XSS risk.
- Created-code lists are session scoped so users only see their own current-session links.
- Session cookies are HttpOnly and SameSite, with the Secure flag enabled through `SESSION_COOKIE_SECURE=true` for HTTPS deployments.
- Security headers are set with Helmet, and generic error pages avoid leaking stack traces.
- Secrets are read from environment variables.
- The app has no database or SQL query surface, so SQL parameterisation is not applicable.
- The app has no accounts or stored passwords; `bcryptjs` is included and wired as the password hashing choice if account support is added later.
