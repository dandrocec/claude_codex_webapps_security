# Express Survey Builder

A Node.js/Express survey builder backed by SQLite. Users can register or log in, create surveys with multiple questions, share public response links, and review collected responses in a table.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5055`.

The app stores its SQLite database at `data/survey_builder.sqlite`. Set `SESSION_SECRET` in your environment for a production-like session secret.
