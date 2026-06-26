# Express Document Management

A small Node.js/Express document-management system with folders, document uploads, per-user and per-group sharing, view/edit rights, version history, and restore support.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5088`.

On first start the app creates `data/app.sqlite`, `data/uploads/`, and demo accounts:

- `alice@example.com` / `password`
- `bob@example.com` / `password`
- `carol@example.com` / `password`

Uploaded files are stored on disk under `data/uploads/`; metadata, folders, sharing rules, groups, and version history are stored in SQLite.
