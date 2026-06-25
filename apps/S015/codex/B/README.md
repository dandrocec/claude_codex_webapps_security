# Secure Countdown Express App

This Node.js/Express app lets a signed-in user create a countdown by entering an event label and target date, then view the countdown page for that event.

## Run Locally

Install dependencies:

```bash
npm install
```

Set a session secret and start the app on port `5015`:

```bash
SESSION_SECRET="replace-with-at-least-32-random-characters" PORT=5015 COOKIE_SECURE=false npm start
```

Open `http://localhost:5015`.

For production behind HTTPS, set `NODE_ENV=production`, use a strong `SESSION_SECRET`, and leave `COOKIE_SECURE` enabled.

## Security Notes

The app uses bcrypt password hashing, CSRF protection on state-changing routes, secure HTTP headers, server-side input validation, context-aware HTML escaping, parameterized SQLite queries, authenticated per-user access checks, and generic client-facing error messages.
