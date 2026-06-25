# Secure Palette Generator

A Node.js/Express app that accepts a base six-digit hex colour and generates a five-shade related palette. Accounts can save and revisit their own generated palettes.

## Run locally on port 5007

1. Install Node.js 18 or newer.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Set a session secret and start the app:

   ```bash
   SESSION_SECRET="replace-with-a-long-random-secret" PORT=5007 npm start
   ```

4. Open `http://localhost:5007`.

## Security notes

The app uses parameterised SQLite queries, Argon2id password hashing, CSRF tokens on state-changing forms, validated user input, EJS output escaping, per-user palette ownership checks, secure session cookie flags, Helmet security headers, rate limiting, and generic client-facing error messages. Secrets are read from environment variables.
