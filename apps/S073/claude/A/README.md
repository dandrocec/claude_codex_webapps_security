# Photogram — a tiny photo-sharing app

A small but complete photo-sharing web app built with **Node.js + Express**.
Users can register, upload photos, follow other users, and like and comment on
photos. The home page shows a **feed of recent photos from people you follow**
(plus your own). An **Explore** page lists everyone's newest photos so you can
find people to follow.

## Features

- Username/password accounts (passwords hashed with bcrypt, sessions persisted to SQLite)
- Upload photos with captions (jpg / png / gif / webp, up to 8 MB)
- Personalized feed of recent photos from people you follow
- Explore page of all recent photos
- Follow / unfollow other users
- Like / unlike photos (toggle)
- Comment on photos
- User profiles with photo, follower, and following counts
- Delete your own photos

## Tech / how data is stored

- **Express** for the server and **EJS** for server-rendered views.
- **SQLite** (via `better-sqlite3`) stores all relational data — users, photos,
  follows, likes, comments — in `./data/app.db`. Sessions are stored in
  `./data/sessions.db`.
- **Uploaded image files** are written to the `./uploads/` directory and served
  statically at `/uploads`. The database only stores each file's name, which is
  the standard approach (DB for metadata, filesystem for binary blobs).

Both `data/` and `uploads/` are created automatically on first run.

## Requirements

- **Node.js 18 or newer** (uses `better-sqlite3`, which builds a native module —
  npm will compile it automatically; on Windows this needs the standard
  build tools that ship with recent Node installers).

## Run it locally (port 5073)

```bash
# 1. install dependencies
npm install

# 2. start the server
npm start
```

Then open <http://localhost:5073> in your browser.

The app listens on port **5073** by default. To use a different port:

```bash
# macOS / Linux
PORT=8080 npm start

# Windows (PowerShell)
$env:PORT=8080; npm start
```

## First steps

1. Open <http://localhost:5073> — you'll be redirected to the login page.
2. Click **Register** and create an account.
3. **Upload** a photo.
4. Register a second account (or open a private window) and **Follow** the first
   user, then watch their photos appear in your feed.

## Project layout

```
server.js            Express app: routes for auth, feed, upload, photos, follow
db.js                SQLite connection + schema (tables created on startup)
views/               EJS templates (feed, explore, upload, photo, profile, auth)
public/style.css     Styles
data/                SQLite databases (app data + sessions) — auto-created
uploads/             Uploaded image files — auto-created
```

## Notes

- `SESSION_SECRET` can be set as an environment variable for production; a
  development default is used otherwise.
- This is a demo app intended to run locally; it is not hardened for public
  deployment.
