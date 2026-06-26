# Personal File Storage

A Node.js/Express app for personal file storage. Users can register, upload files into folders, create read-only share links for individual files, and revoke those links.

## Run locally

Install dependencies:

```bash
npm install
```

Start the app on port 5082:

```bash
npm start
```

Open `http://localhost:5082`.

## Storage

SQLite data is stored in `data/app.db`, session data in `data/sessions.db`, and uploaded files in `data/files/`. These paths are created automatically when the app starts.
