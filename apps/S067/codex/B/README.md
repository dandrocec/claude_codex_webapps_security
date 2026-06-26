# Secure Food Ordering

Node.js/Express app for customer food ordering and staff order management. Data is stored in SQLite, order totals are computed on the server, and passwords are hashed with bcrypt.

## Run locally on port 5067

```bash
npm install
SESSION_SECRET="replace-with-a-long-random-secret" SESSION_COOKIE_SECURE=false STAFF_EMAIL="staff@example.com" STAFF_PASSWORD="change-this-staff-password" npm start
```

Then open `http://localhost:5067`.

Customers can register from the app. A staff account is created at startup only when `STAFF_EMAIL` and `STAFF_PASSWORD` are provided.

## Environment

- `PORT`: optional, defaults to `5067`
- `DATABASE_PATH`: optional, defaults to `./data/app.db`
- `SESSION_SECRET`: required for secure session signing
- `SESSION_COOKIE_SECURE`: set to `false` only for local plain HTTP testing; defaults to secure cookies
- `STAFF_EMAIL` / `STAFF_PASSWORD`: optional initial staff account
