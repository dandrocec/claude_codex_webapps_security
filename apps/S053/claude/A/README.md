# Express Portfolio

A small portfolio website built with **Node.js + Express**.

- **Public page** (`/`) shows all projects in a responsive grid.
- **Owner area** (`/admin`) — login-protected — lets the owner create, edit, and delete
  projects (title, description, link, image).
- Data is stored in a **SQLite database** (created automatically, no DB server to install).
- Images are uploaded to `public/uploads/`.

## Requirements

- Node.js 18 or newer (includes npm)

## Run locally (port 5053)

```bash
# 1. Install dependencies
npm install

# 2. (optional) configure environment
cp .env.example .env      # then edit values if you like

# 3. Start the server
npm start
```

Then open <http://localhost:5053>.

The server listens on port **5053** by default. You can override it with the `PORT`
environment variable (or via `.env`).

## Logging in as the owner

On first run an owner account is created automatically:

| Username | Password   |
| -------- | ---------- |
| `admin`  | `changeme` |

Change these by setting `ADMIN_USER` / `ADMIN_PASS` (in `.env` or the environment)
**before the first run**, or by editing the `.env` and deleting `data/portfolio.db`
to recreate the account.

Go to <http://localhost:5053/login>, sign in, and you'll land on the dashboard at
`/admin` where you can manage projects.

## Project structure

```
server.js              Express app, routes, auth, uploads
db.js                  SQLite setup + data-access helpers
views/                 EJS templates (public grid, login, admin, forms)
public/css/style.css   Styles
public/uploads/        Uploaded project images (created at runtime)
data/                  SQLite database + session store (created at runtime)
```

## Notes

- Passwords are hashed with bcrypt; sessions are stored in SQLite.
- Uploads are limited to image files up to 5 MB.
- For production, set a strong `SESSION_SECRET` and run behind HTTPS.
