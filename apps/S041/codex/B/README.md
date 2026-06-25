# Secure FAQ Editor

Node.js/Express FAQ app with an editor login, category grouping, keyword filtering, SQLite storage, CSRF protection, secure headers, bcrypt password hashing, and owner-scoped editor actions.

## Run locally on port 5041

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file:
   ```bash
   PORT=5041
   SESSION_SECRET=replace-with-a-long-random-secret
   DATABASE_PATH=./data/faq.sqlite
   COOKIE_SECURE=false
   ```
   `COOKIE_SECURE=false` is only for local HTTP development. Use secure cookies in production behind HTTPS.
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:5041`. On first use, visit `/setup` to create the initial editor account.

