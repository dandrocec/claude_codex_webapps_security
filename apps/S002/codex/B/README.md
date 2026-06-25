# Secure BMI Express App

A small Node.js and Express app that accepts height in centimeters and weight in kilograms, calculates BMI, and displays the BMI category.

## Run locally on port 5002

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Start the app:

   ```bash
   npm start
   ```

4. Open `http://localhost:5002`.

## Security notes

- SQL access uses SQLite parameter placeholders instead of string interpolation.
- Password storage uses bcrypt with a per-password salt. The demo user is created automatically so ownership checks can be enforced.
- Height and weight are validated and normalized with `express-validator`.
- EJS escaped output tags are used for context-aware HTML output encoding.
- `csurf` protects the state-changing BMI form submission.
- BMI records are fetched with both record ID and session user ID to prevent IDOR.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`.
- `helmet` sets security headers including a restrictive Content Security Policy.
- Error responses return generic messages and do not expose stack traces.
- Runtime secrets are read from environment variables.
