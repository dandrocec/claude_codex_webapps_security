# Secure Express To-Do App

A Node.js/Express to-do app with registration, login, per-user task access, SQLite storage, bcrypt password hashing, CSRF protection, secure headers, and server-rendered EJS templates.

## Run locally on port 5027

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set a strong session secret:

   ```bash
   set SESSION_SECRET=replace-with-a-long-random-secret
   ```

   On macOS/Linux:

   ```bash
   export SESSION_SECRET=replace-with-a-long-random-secret
   ```

3. Start the app:

   ```bash
   npm start
   ```

4. Open `http://localhost:5027`.

By default the app stores data in `data/todos.sqlite`. Override this with `DATABASE_FILE`. For local HTTP development, cookies use `HttpOnly` and `SameSite=Lax`; set `COOKIE_SECURE=true` when serving over HTTPS or behind a TLS-terminating proxy.
