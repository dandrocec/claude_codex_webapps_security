# Crowdfund

A small crowdfunding site built with **Node.js + Express** and **SQLite**.

- Creators launch campaigns with a funding **goal** and a **deadline**.
- Backers **pledge** amounts to a campaign.
- Each campaign page shows the **total raised**, **number of backers**, **days left**, and a **progress bar** toward the goal.

## Requirements

- Node.js 18 or newer (includes npm)

## Run it locally

```bash
npm install
npm start
```

Then open **http://localhost:5069**.

Data is stored in a SQLite file (`crowdfund.db`) that is created automatically in the project folder on first run. To start fresh, stop the server and delete `crowdfund.db` (and the `crowdfund.db-wal` / `crowdfund.db-shm` files).

### Changing the port

The app listens on port **5069** by default. To use a different port:

```bash
# macOS / Linux
PORT=8080 npm start

# Windows (PowerShell)
$env:PORT=8080; npm start
```

## How it works

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | GET | List all campaigns with progress |
| `/campaigns/new` | GET | Form to create a campaign |
| `/campaigns` | POST | Create a campaign |
| `/campaigns/:id` | GET | Campaign detail + backers + pledge form |
| `/campaigns/:id/pledge` | POST | Back a campaign |

### Project layout

```
server.js          Express app and routes
db.js              SQLite connection + schema (auto-created)
views/             EJS templates
public/style.css   Styles
```

Amounts are stored as integer **cents** to avoid floating-point rounding issues, and pledges after a campaign's deadline are rejected.
