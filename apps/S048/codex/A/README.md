# Feedback Portal

A Node.js/Express feedback portal backed by SQLite. Visitors can submit feedback with a category, rating, and comment. A logged-in reviewer can view every submission in a sortable table.

## Run locally

Install dependencies:

```bash
npm install
```

Start the app on port 5048:

```bash
npm start
```

Open `http://localhost:5048`.

## Reviewer login

Default credentials:

- Username: `reviewer`
- Password: `reviewer`

You can override them with environment variables:

```bash
REVIEWER_USERNAME=admin REVIEWER_PASSWORD=change-me npm start
```

The SQLite database is created automatically as `feedback.db` in the project directory. Set `DB_PATH` to use a different location.
