# Collaborative Editor

A Node.js/Express collaborative document editor with SQLite persistence, per-document access lists, invite-only view/edit permissions, and live updates through Socket.IO.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5098`.

The app stores data in `data.sqlite` by default. To use a different database path or port:

```bash
DB_PATH=./my-data.sqlite PORT=5098 npm start
```

Use any name in the "Current user" field to sign in. Create a document, invite another user with view or edit access, then open the app in another browser or private window with that collaborator name to see shared updates.
