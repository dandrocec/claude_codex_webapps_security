# Ticket Desk

A Node.js/Express ticketing app backed by SQLite. Organisers can create events with a fixed ticket allocation, users can buy available tickets, and purchases are stored so each user can view their tickets.

Ticket purchases use a SQLite transaction and an atomic availability update to prevent overselling.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5084`.

The app creates its SQLite database at `data/tickets.sqlite`. To use a different port, set `PORT` before starting the app.
