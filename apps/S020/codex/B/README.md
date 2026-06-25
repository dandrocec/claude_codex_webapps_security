# Secure JSON Formatter

A Node.js/Express app that validates pasted JSON and shows either a neatly indented result or a parse error. Registered users can save formatted JSON snippets to their own account.

## Run locally on port 5020

```bash
npm install
SESSION_SECRET="replace-with-at-least-32-random-characters" COOKIE_SECURE=false PORT=5020 npm start
```

Open `http://localhost:5020`.

`COOKIE_SECURE=false` is only for local HTTP development. In production, leave it unset so session cookies are marked `Secure`, and serve the app over HTTPS. Optional settings include `DB_PATH` for the SQLite database file and `PORT` for the listening port.
