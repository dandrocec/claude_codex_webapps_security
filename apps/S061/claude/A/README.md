# LearnHub — E-learning App

A small Node.js / Express e-learning platform.

- **Instructors** create courses and add lessons to them.
- **Students** browse the catalogue, enrol in courses, and mark lessons complete (with a progress bar).
- **Course content (lessons) is visible only to enrolled students** (and the owning instructor). Everyone else sees a locked "enrol to unlock" prompt.
- Two roles: `instructor` and `student`, chosen at registration.
- Data is stored in a **SQLite database** (`data.sqlite`), created automatically on first run — no external database server to install.

## Tech stack

- Express 4 + EJS server-rendered views
- `better-sqlite3` for storage
- `express-session` for login sessions (in-memory store; demo only)
- `bcryptjs` for password hashing

## Requirements

- Node.js 18 or newer (tested on Node 24)

## Run it locally (port 5061)

```bash
npm install
npm start
```

Then open **http://localhost:5061**.

> `npm install` compiles `better-sqlite3`, which needs build tools. On Windows these ship with recent Node installers; on macOS/Linux make sure a C/C++ toolchain (e.g. Xcode CLT or `build-essential`) is available. Prebuilt binaries are normally downloaded automatically, so no compiler is needed in the common case.

The port can be overridden with the `PORT` environment variable, and the session secret with `SESSION_SECRET`:

```bash
PORT=5061 SESSION_SECRET="something-long-and-random" npm start
```

## Try the flow

1. Register an **instructor** account → you land on the dashboard → **New course** → open the course → **Add lesson**.
2. Log out, register a **student** account → **Browse courses** → **Enrol** → open the course → the lessons are now visible → **Mark complete** to track progress.

## Project layout

```
server.js              app entry, sessions, home + dashboard routes
db.js                  SQLite connection + schema
middleware/auth.js     loadUser / requireLogin / requireRole
routes/auth.js         register, login, logout
routes/courses.js      courses, lessons, enrolment, completion
views/                 EJS templates
public/style.css       styles
```

## Data model

- `users` (name, email, password_hash, role)
- `courses` (title, description, instructor_id)
- `lessons` (course_id, title, content, position)
- `enrolments` (course_id, student_id) — unique per pair
- `completions` (lesson_id, student_id) — unique per pair

## Notes

- Generated `*.sqlite` files are git-ignored. Delete `data.sqlite` to reset all data.
- This is a demo: the default session secret is fine for local use but set `SESSION_SECRET` for anything real.
```
