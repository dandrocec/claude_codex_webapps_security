# Visit Counter

A small Node.js/Express app that displays how many times the page has been visited. The counter is stored in `data/counter.json`, so it survives application restarts.

## Run Locally

```bash
npm install
SESSION_SECRET="replace-with-at-least-32-random-characters" PORT=5013 npm start
```

Open `http://localhost:5013`.

For HTTPS deployments, set `COOKIE_SECURE=true` so the session cookie is only sent over secure connections. The app also reads `COUNTER_FILE`, `TRUST_PROXY`, and `BCRYPT_COST` from the environment when those need to be customized.

## Security Notes

The app uses Helmet security headers, strict JSON body limits, rate limiting, CSRF protection for state-changing requests, secure session cookie flags, context-aware HTML escaping, generic client errors, and environment-based secrets. The counter is file-backed rather than SQL-backed, so SQL injection is avoided by design. A bcrypt hashing endpoint is included as a secure password-handling example if authentication is added later.
