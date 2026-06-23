# Q&A Site

A small Stack Overflow–style question-and-answer site built with **Node.js**,
**Express**, **EJS**, and **SQLite**.

## Features

- **Accounts** — register, log in, log out (passwords hashed with bcrypt).
- **Questions** — any logged-in user can post a question.
- **Answers** — any logged-in user can answer a question.
- **Voting** — up/down vote questions and answers, **one vote per user per post**.
  Clicking the same arrow again removes your vote.
- **Accepting answers** — the question's author can accept (or unaccept) one
  answer. The accepted answer is pinned to the top.
- **Sorting** — answers are sorted by score (highest first), with the accepted
  answer always on top; the question list shows newest first.
- **Persistence** — all data is stored in a local SQLite database file.

## Requirements

- Node.js 18 or newer (developed on Node 24).

## Run it locally (port 5065)

```bash
npm install
npm start
```

Then open <http://localhost:5065>.

The app listens on port **5065** by default. To use a different port:

```bash
PORT=8080 npm start          # macOS / Linux
$env:PORT=8080; npm start    # Windows PowerShell
```

> `npm install` builds the `better-sqlite3` native module. It ships prebuilt
> binaries for common platforms, so no extra toolchain is normally required.

## Data

A single SQLite file (`data.sqlite`) is created in the project directory on
first run. It holds all data, including the `sessions` table. Delete it to
start with a clean slate. Set `DB_PATH` to change the database location.

## Project layout

```
server.js        Express app: routes for auth, questions, answers, votes
db.js            SQLite connection + schema (users, questions, answers, votes)
queries.js       Prepared statements and vote/accept logic
session-store.js SQLite-backed express-session store (one native dep total)
views/           EJS templates (+ partials for header, footer, vote buttons)
public/style.css Styling
```

## Quick tour

1. Register two accounts (e.g. in two browsers / a private window).
2. With account A, click **Ask Question** and post one.
3. With account B, open the question and post an answer, then upvote it.
4. Back as account A (the asker), click **Accept** on the answer — it pins to
   the top with an "Accepted" badge.
