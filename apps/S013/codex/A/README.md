# Visit Counter Express App

A small Node.js/Express application that increments a persisted visit counter every time the single page is loaded.

## Run locally on port 5013

```bash
npm install
npm start
```

Then open:

```text
http://localhost:5013
```

The visit count is stored in `data/visits.json`, so it survives application restarts.
