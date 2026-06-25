# Express Polling App

A Node.js/Express polling app where registered users can create polls, visitors can vote once per poll, and everyone can watch live results update as a bar chart.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:5043`.

The app stores its SQLite database and session database in the local `data/` directory. Set `PORT=5043` or another port if needed, and set `SESSION_SECRET` in production-like environments.
