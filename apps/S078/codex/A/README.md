# Pipeline CRM

A Node.js/Express CRM for sales teams. Sales users manage their own contacts and deals, move deals across a pipeline board, and managers can view and manage the whole team's records.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5078`.

The app creates a file-backed SQLite database at `data/crm.sqlite` on first start and seeds demo accounts:

- `manager@example.com`
- `sam@example.com`
- `riley@example.com`

All demo passwords are `password123`.

Set `PORT=5078` or another port before starting if needed. The default is `5078`.
