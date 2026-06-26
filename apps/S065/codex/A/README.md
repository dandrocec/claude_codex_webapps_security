# Express Q&A Site

A small Node.js/Express question-and-answer site. Users can post questions and answers, vote once per question or answer, and the question author can accept an answer. Data is stored in a SQLite database at `data/qa.sqlite`.

## Run locally

Install dependencies:

```bash
npm install
```

Start the app on port 5065:

```bash
npm start
```

Open `http://localhost:5065` in your browser.

You can override the database path with `DATABASE_PATH=/path/to/qa.sqlite npm start`.
