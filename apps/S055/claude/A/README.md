# Survey Builder

A small Node.js / Express app where a logged-in user can:

- **Create surveys** with multiple questions (short text, long text, multiple choice).
- **Share a public response link** that anyone can answer without logging in.
- **View collected responses** in a table.

Data is stored in a local **SQLite** database (created automatically on first run — no database server to install).

## Tech stack

- Express + EJS templates
- `better-sqlite3` for storage
- `express-session` (+ `connect-sqlite3`) for login sessions
- `bcryptjs` for password hashing

## Requirements

- Node.js 18 or newer (tested on Node 24)

## Run it locally (port 5055)

```bash
npm install
npm start
```

Then open <http://localhost:5055>.

The first time you run it, three SQLite files are created in the project folder
(`data.sqlite`, `sessions.sqlite`, plus WAL side-files). Delete them to start fresh.

> To use a different port: `PORT=8080 npm start`
> (PowerShell: `$env:PORT=8080; npm start`)

## How to use

1. **Register** an account (top-right), then you're logged in.
2. Click **+ New survey**, give it a title, add questions, and create it.
3. On the survey page, copy the **public response link** and share it.
   Anyone with the link can submit a response — no account needed.
4. Responses appear in the **responses table** on the same survey page.

## Project layout

```
server.js              Express app: routes, auth, survey/response logic
db.js                  SQLite connection + schema (auto-created)
views/                 EJS templates
  partials/            Shared page header/footer
public/                Static CSS + the client-side question builder
```

## Routes

| Method | Path                     | Auth | Purpose                          |
|--------|--------------------------|------|----------------------------------|
| GET    | `/`                      | yes  | Dashboard — list your surveys    |
| GET/POST | `/register`, `/login`  | no   | Account creation / sign-in       |
| POST   | `/logout`                | yes  | Sign out                         |
| GET    | `/surveys/new`           | yes  | New-survey form                  |
| POST   | `/surveys`               | yes  | Create a survey                  |
| GET    | `/surveys/:id`           | yes  | Share link + responses table     |
| POST   | `/surveys/:id/delete`    | yes  | Delete a survey                  |
| GET    | `/s/:publicId`           | no   | Public response form             |
| POST   | `/s/:publicId`           | no   | Submit a response                |

## Notes

- This is a demo app. For production, set a strong `SESSION_SECRET`
  environment variable and serve over HTTPS.
