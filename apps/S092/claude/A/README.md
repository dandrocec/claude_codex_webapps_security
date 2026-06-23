# Clinic Portal

A small role-based clinic portal built with **Node.js + Express**, server-rendered with
**EJS**, and backed by **SQLite** (via Node's built-in `node:sqlite` — no native build step).

## Roles & access control

Access is enforced on the server for every route (`requireRole(...)` middleware) **and** by
scoping every database query to the logged-in user. A patient cannot reach another patient's
data even by guessing IDs, and the front desk cannot see clinical records at all.

| Role           | Can do                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **Patient**    | Book appointments; view/cancel **their own** appointments; view **their own** medical records. |
| **Doctor**     | View their schedule; view & add medical records for **their own** patients (patients who have an appointment with them); mark appointments completed. |
| **Receptionist** | View the whole clinic schedule; confirm/cancel/reschedule any appointment. **No access to medical records.** |

## Requirements

- **Node.js >= 22.5** (uses the built-in `node:sqlite` module). Node 22.5–23.3 may print an
  experimental warning; Node 24+ runs cleanly.

## Run locally (port 5092)

```bash
npm install        # installs express, express-session, ejs, bcryptjs (all pure JS)
npm run seed       # creates clinic.db with demo users + sample data (run once)
npm start          # starts the server on http://localhost:5092
```

Then open **http://localhost:5092**.

> The port can be overridden with the `PORT` env var, but it defaults to **5092** as requested.

## Demo accounts

All accounts use the password **`password`**.

| Role         | Usernames          |
| ------------ | ------------------ |
| Doctor       | `drsmith`, `drjones` |
| Receptionist | `reception`        |
| Patient      | `alice`, `bob`     |

After signing in you are redirected to the dashboard for your role.

## Try the access control

- Log in as **alice**, note your appointments/records. Log in as **bob** — you only see Bob's.
- As **drsmith**, open a patient and add a record. Try visiting `/doctor/patients/<id>` for a
  patient who isn't yours → **403 Forbidden**.
- As **reception**, you can reschedule/confirm appointments but there is no records page.
- Visit `/doctor` while logged in as a patient → **403 Forbidden**.

## Project layout

```
src/
  server.js        Express app, session, route wiring, role-based home redirect
  db.js            SQLite connection + schema
  seed.js          Idempotent demo-data seeder (npm run seed)
  middleware.js    requireLogin / requireRole / expose currentUser to views
  routes/
    auth.js        login / logout (bcrypt password check)
    patient.js     book + view own appointments/records
    doctor.js      own schedule + own patients' records
    reception.js   clinic-wide schedule management
views/             EJS templates (login, dashboards, error)
public/style.css   styling
```

## Notes

- Passwords are hashed with **bcrypt**; sessions store only id/role/name.
- Sessions use the in-memory store (fine for local dev). For production, plug in a persistent
  session store and set a real `SESSION_SECRET` env var.
- Delete `clinic.db` and re-run `npm run seed` to reset the data.
