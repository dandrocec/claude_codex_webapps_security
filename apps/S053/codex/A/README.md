# Express Portfolio Site

A Node.js/Express portfolio app with a public project grid and an owner dashboard for creating, editing, and deleting projects. Project and session data are stored in SQLite under `data/`.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:5053`.

Default owner login:

- Username: `owner`
- Password: `changeme`

For local configuration, set environment variables before starting:

```bash
PORT=5053 OWNER_USER=owner OWNER_PASSWORD=your-password SESSION_SECRET=your-secret npm start
```
