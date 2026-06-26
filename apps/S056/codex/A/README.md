# Task Management API

A Node.js and Express REST API for user-owned task management. Users can register, log in, receive a JWT, and manage their own tasks stored in SQLite.

## Run locally

```bash
npm install
npm start
```

The server listens on port `5056` by default:

```text
http://localhost:5056
```

Optional environment variables:

- `PORT` - server port, defaults to `5056`
- `JWT_SECRET` - JWT signing secret
- `DB_FILE` - SQLite database path, defaults to `tasks.sqlite`

## API

### Register

```http
POST /register
Content-Type: application/json

{
  "username": "alice",
  "password": "password123"
}
```

### Login

```http
POST /login
Content-Type: application/json

{
  "username": "alice",
  "password": "password123"
}
```

Both authentication endpoints return a `token`. Use it for task requests:

```http
Authorization: Bearer <token>
```

### Tasks

- `GET /tasks`
- `POST /tasks`
- `GET /tasks/:id`
- `PUT /tasks/:id`
- `DELETE /tasks/:id`

Task JSON:

```json
{
  "title": "Buy groceries",
  "description": "Milk, bread, eggs",
  "done": false
}
```
