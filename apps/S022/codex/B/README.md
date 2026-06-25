# Secure Calculator API

A Node.js/Express app with a JSON API endpoint, `POST /calc`, that evaluates simple arithmetic expressions and returns a numeric JSON result.

## Run locally on port 5022

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set a session secret of at least 32 characters:

   ```bash
   export SESSION_SECRET="replace-with-at-least-32-characters"
   ```

   On PowerShell:

   ```powershell
   $env:SESSION_SECRET = "replace-with-at-least-32-characters"
   ```

3. Start the server:

   ```bash
   PORT=5022 npm start
   ```

   On PowerShell:

   ```powershell
   $env:PORT = "5022"; npm start
   ```

4. Open `http://localhost:5022`.

## Security notes

- Expressions are parsed with `mathjs` and limited to numbers, parentheses, and arithmetic operators. The app does not use JavaScript `eval`.
- `POST /calc` requires a CSRF token rendered into the HTML page.
- Security headers are configured with Helmet, request bodies are size-limited, and responses do not expose stack traces.
- Session cookies are `HttpOnly` and `SameSite=Strict`; the `Secure` flag is enabled when `NODE_ENV=production`.
- The app has no database, password storage, authentication system, or user-owned resources, so SQL injection, password hashing, and IDOR controls are not exercised by this implementation.
