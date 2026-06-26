# Secure Photo Share

A Node.js/Express photo-sharing app with local accounts, photo uploads, follows, likes, comments, and a feed of recent photos from followed users.

## Run locally on port 5073

1. Install dependencies:
   `npm install`
2. Set a session secret:
   `SESSION_SECRET=replace-with-a-long-random-secret`
3. For local HTTP development only, allow non-secure cookies:
   `COOKIE_SECURE=false`
4. Start the app:
   `npm start`
5. Open `http://localhost:5073`

Uploaded files are stored in `data/uploads` under server-generated names, and SQLite data is stored in `data/app.db`.
