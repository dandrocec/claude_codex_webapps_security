# Warehouse Stock Orders

Node.js/Express warehouse app for managing stock and processing orders. Data is stored in SQLite.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5080`.

## Demo users

- Manager: `manager` / `manager123`
- Clerk: `clerk` / `clerk123`

Managers can create and edit products, adjust stock, view users, and process orders. Clerks can view inventory and process orders. Orders are rejected when requested quantities exceed available stock.
