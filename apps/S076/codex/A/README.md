# Express Room Chat

A Node.js/Express chat app where registered users can log in, create chat rooms, browse rooms, and exchange persistent messages shown in chronological order.

## Run Locally

```bash
npm install
npm start
```

The app runs on port `5076` by default:

```text
http://localhost:5076
```

Set `PORT` or `SESSION_SECRET` if needed:

```bash
PORT=5076 SESSION_SECRET=change-me npm start
```

SQLite database files are created automatically in the `data/` directory.
