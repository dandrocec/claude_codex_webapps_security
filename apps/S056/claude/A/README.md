# Task Management API

A small REST API for managing personal tasks, built with **Node.js + Express**.
Authentication uses **JWT**; each user can only see and modify their own tasks.
Data is persisted to a local JSON file (`data/db.json`) — no database server or
native build tools required.

## Requirements

- Node.js >= 18 (developed on Node 24)

## Setup & run (local, port 5056)

```bash
npm install
npm start
```

The server listens on **http://localhost:5056**.

To override the port or JWT secret:

```bash
# bash
PORT=5056 JWT_SECRET="your-secret" npm start
```

```powershell
# PowerShell
$env:PORT=5056; $env:JWT_SECRET="your-secret"; npm start
```

> For development with auto-reload: `npm run dev`

## Authentication

1. `POST /register` or `POST /login` returns a JWT `token`.
2. Send it on task requests via the header: `Authorization: Bearer <token>`.

Tokens expire after 1 hour by default (`JWT_EXPIRES_IN`).

## Endpoints

| Method | Path          | Auth | Description                       |
|--------|---------------|------|-----------------------------------|
| POST   | `/register`   | No   | Create an account, returns a token |
| POST   | `/login`      | No   | Log in, returns a token            |
| GET    | `/tasks`      | Yes  | List your tasks                    |
| POST   | `/tasks`      | Yes  | Create a task                      |
| GET    | `/tasks/:id`  | Yes  | Get one of your tasks              |
| PUT    | `/tasks/:id`  | Yes  | Update one of your tasks           |
| DELETE | `/tasks/:id`  | Yes  | Delete one of your tasks           |

### Task shape

```json
{
  "id": 1,
  "title": "Buy milk",
  "description": "2% organic",
  "done": false,
  "createdAt": "2026-06-15T10:00:00.000Z",
  "updatedAt": "2026-06-15T10:00:00.000Z"
}
```

- `title` is required when creating a task.
- `description` (string) and `done` (boolean) are optional; default `""` and `false`.
- On `PUT`, send any subset of `title`, `description`, `done`.

## Example with curl

```bash
# Register (or use /login if the account already exists)
TOKEN=$(curl -s -X POST http://localhost:5056/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret123"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

# Create a task
curl -s -X POST http://localhost:5056/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Buy milk","description":"2% organic"}'

# List tasks
curl -s http://localhost:5056/tasks -H "Authorization: Bearer $TOKEN"

# Update a task
curl -s -X PUT http://localhost:5056/tasks/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"done":true}'

# Delete a task
curl -s -X DELETE http://localhost:5056/tasks/1 -H "Authorization: Bearer $TOKEN"
```

## Project layout

```
src/
  server.js        # entry point — starts the HTTP server on port 5056
  app.js           # Express app wiring & error handling
  auth.js          # JWT signing + auth middleware
  db.js            # JSON-file data store (users + tasks)
  routes/
    users.js       # POST /register, POST /login
    tasks.js       # CRUD for /tasks
data/db.json       # created at runtime (gitignored)
```

## Notes

- Passwords are hashed with bcrypt; only the hash is stored.
- The default `JWT_SECRET` is for local development only — set a real secret via
  the environment for any shared or production use.
