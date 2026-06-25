# Secure Redirect Registry

A Node.js/Express app where authenticated users can register named redirects and visit them with `/go?to=<key>`.

## Run locally on port 5024

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file:

   ```bash
   PORT=5024
   SESSION_SECRET=replace-with-at-least-32-random-characters
   DATABASE_PATH=./data.sqlite
   NODE_ENV=development
   ```

3. Start the app:

   ```bash
   npm start
   ```

4. Open `http://localhost:5024`, create an account, register redirects, and use `/go?to=<key>` while signed in.

## Security notes

- SQL access uses parameterized prepared statements.
- Passwords are hashed with Argon2id.
- State-changing requests are protected with CSRF tokens.
- Redirects are scoped to the authenticated user.
- Sessions use HttpOnly, SameSite cookies and enable Secure cookies when `NODE_ENV=production`.
- Helmet configures security headers, and client-facing errors avoid stack traces.
