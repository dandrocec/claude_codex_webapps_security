# Express File Sharing App

A small Node.js/Express app where users can register, sign in, upload files, and download their own uploads. Files are stored on disk under `data/uploads`, while users, sessions, and file metadata are stored in SQLite databases under `data`.

## Run locally

```bash
npm install
npm start
```

The app runs on port `5045` by default:

```text
http://localhost:5045
```

To use a different port:

```bash
PORT=5045 npm start
```

Set `SESSION_SECRET` in your environment for non-local use.
