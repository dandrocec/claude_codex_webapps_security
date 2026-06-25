# Secure Markdown Preview

A Node.js/Express app that renders Markdown entered in a textarea and displays the sanitized HTML output on the same page.

## Run locally on port 5005

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set required environment variables:

   ```bash
   SESSION_SECRET="replace-with-at-least-32-random-characters"
   DEMO_PASSWORD="choose-a-local-demo-password"
   PORT=5005
   ```

3. Start the app:

   ```bash
   npm start
   ```

4. Open `http://localhost:5005` and sign in with username `demo` and the password from `DEMO_PASSWORD`.

## Security notes

The app uses Helmet security headers, CSRF tokens for state-changing requests, secure session cookie settings, bcrypt password hashing, parameterized SQLite queries, input validation, sanitized Markdown output, access checks on saved previews, rate limiting, and generic client-facing error messages. Secrets are read from environment variables.
