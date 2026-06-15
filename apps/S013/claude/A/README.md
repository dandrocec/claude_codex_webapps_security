# Visit Counter

A minimal Node.js/Express app with a single page that displays how many times it
has been visited. The counter is persisted to `counter.json`, so the count
survives server restarts, and it increments on every page load.

## Requirements

- Node.js 18 or newer

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:5013 in your browser. Each refresh increments the count.

The app listens on port **5013** by default. To use a different port, set the
`PORT` environment variable, e.g. `PORT=8080 npm start`.

## How persistence works

The count is stored in `counter.json` next to `server.js`. The file is created
automatically on first visit and read/written on each request, so the value
carries over across restarts. Delete the file to reset the counter to zero.
