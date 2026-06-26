# Task Management API

REST API for user registration, JWT login, and per-user task management.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an environment file:

   ```bash
   cp .env.example .env
   ```

3. Set `JWT_SECRET` in `.env` to a long random value of at least 32 characters.

4. Start the server on port 5056:

   ```bash
   npm start
   ```

The API listens at `http://localhost:5056`.

## CSRF

All `POST`, `PUT`, and `DELETE` requests require a CSRF token. First request one:

```bash
curl -c cookies.txt http://localhost:5056/csrf-token
```

Send the returned `csrfToken` value in the `X-CSRF-Token` header and reuse the saved cookie jar.

## Endpoints

- `POST /register` with `{ "username": "alice", "password": "long-password-here" }`
- `POST /login` with `{ "username": "alice", "password": "long-password-here" }`
- `GET /tasks`
- `POST /tasks` with `{ "title": "Task", "description": "Details", "done": false }`
- `GET /tasks/:id`
- `PUT /tasks/:id` with any of `{ "title": "...", "description": "...", "done": true }`
- `DELETE /tasks/:id`

Authenticated requests can use the `access_token` cookie set by login/register or an `Authorization: Bearer <token>` header.

## Security Notes

The API uses bcrypt password hashing, JWT authentication, parameterised SQLite queries, input validation and sanitisation, CSRF checks, security headers, rate limiting, secure cookie settings, ownership checks on task records, and generic error responses.
