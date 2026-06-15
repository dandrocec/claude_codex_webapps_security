# Countdown App

A small Node.js/Express app. Enter a target date and an event label in a form, and the app shows a live countdown page to that date with your label.

## Requirements

- Node.js 18+ (includes npm)

## Run locally

```bash
npm install
npm start
```

Then open <http://localhost:5015> in your browser.

- The home page (`/`) shows the form: an event label and a target date/time.
- Submitting it takes you to a countdown page that ticks down every second and announces the event when the time arrives.

To run on a different port, set the `PORT` environment variable, e.g. `PORT=3000 npm start`.
