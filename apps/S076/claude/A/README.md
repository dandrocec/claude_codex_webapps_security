# Express Chat

A small multi-room chat application built with **Node.js + Express** and an
**SQLite** database. Logged-in users can create chat rooms, see the list of
rooms, and exchange messages that are persisted and shown in chronological
order.

## Features

- User registration and login (passwords hashed with bcrypt, sessions stored
  server-side).
- Create chat rooms and browse the list of all rooms (with message counts).
- Send messages that are saved to the database and displayed in order.
- New messages appear automatically via lightweight polling (every 2s).
- All data (users, rooms, messages, sessions) persists in SQLite files on disk.

## Tech stack

| Concern        | Choice                                   |
| -------------- | ---------------------------------------- |
| Server         | Express                                  |
| Database       | SQLite via `better-sqlite3`              |
| Auth/Sessions  | `express-session` + `connect-sqlite3`    |
| Passwords      | `bcryptjs`                               |
| Frontend       | Static HTML/CSS/vanilla JS (no build)    |

## Requirements

- Node.js **18 or newer** (tested on Node 24).
- npm (bundled with Node).

## Run it locally (port 5076)

From the project directory:

```bash
npm install
npm start
```

Then open <http://localhost:5076> in your browser.

The server listens on port **5076** by default. To use a different port:

```bash
# macOS / Linux
PORT=8080 npm start

# Windows (PowerShell)
$env:PORT=8080; npm start
```

## How to use

1. Open the app, click **Register**, and create an account.
2. You'll land in the default **# general** room.
3. Create new rooms with the box at the bottom of the sidebar.
4. Click any room in the sidebar to open it and start chatting.
5. Open a second browser (or an incognito window), register another user, and
   chat between the two to see messages appear live.

## Project layout

```
.
├── server.js          # Express app, API routes, session setup
├── db.js              # SQLite connection + schema (users, rooms, messages)
├── package.json       # Dependencies and scripts
├── public/            # Frontend served as static files
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── chat.db            # SQLite database (created on first run)
└── sessions.db        # Session store (created on first run)
```

## API overview

| Method | Endpoint                          | Description                       |
| ------ | --------------------------------- | --------------------------------- |
| POST   | `/api/register`                   | Create account and log in         |
| POST   | `/api/login`                      | Log in                            |
| POST   | `/api/logout`                     | Log out                           |
| GET    | `/api/me`                         | Current logged-in user            |
| GET    | `/api/rooms`                      | List all rooms                    |
| POST   | `/api/rooms`                      | Create a room                     |
| GET    | `/api/rooms/:id/messages`         | List messages (supports `?after=`)|
| POST   | `/api/rooms/:id/messages`         | Post a message                    |

All `/api/rooms*` endpoints require an authenticated session.

## Notes

- The database files (`chat.db`, `sessions.db`) are created automatically on
  first run and are git-ignored. Delete them to reset all data.
- For production you should set a strong `SESSION_SECRET` environment variable
  and serve over HTTPS.
