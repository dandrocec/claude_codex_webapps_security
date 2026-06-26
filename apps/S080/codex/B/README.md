# Secure Warehouse App

Node.js/Express warehouse app for stock management and order fulfillment. It uses SQLite for persistence, bcrypt for password hashing, CSRF protection, secure sessions, validation, role-based access control, and security headers.

## Run locally on port 5080

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file:

   ```bash
   PORT=5080
   SESSION_SECRET=replace-with-a-long-random-secret
   DATABASE_PATH=./data/warehouse.sqlite
   SESSION_COOKIE_SECURE=false
   ```

   `SESSION_COOKIE_SECURE=false` is only for local HTTP development. Use `true` behind HTTPS in production.

3. Start the app:

   ```bash
   npm start
   ```

4. Open `http://localhost:5080`.

On first launch, the app shows a one-time setup page to create the initial manager account. Managers can create users and manage inventory. Clerks can create orders, and orders are rejected when stock is insufficient.
