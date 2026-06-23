# Quiz Platform

A small Node.js / Express application where **teachers** create multiple‑choice
quizzes and **students** take them and get an automatically computed score.

Data is stored in a **SQLite** database (`quiz.db`, created automatically on
first run) via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3).

## Features

- Teachers build a quiz with any number of questions, each with multiple options
  and exactly one correct answer.
- Students take a quiz and receive an instant percentage score plus a per‑question
  review.
- **Correct answers are never exposed before submission.** The endpoint that
  renders a quiz for a student selects only the option *text* and *id* from the
  database — the `is_correct` flag stays on the server and is read only while
  grading a submission.

## Requirements

- Node.js 18 or newer (includes `npm`).

## Run it locally on port 5075

```bash
npm install
npm start
```

Then open <http://localhost:5075>.

The server listens on port **5075** by default. To use a different port:

```bash
# macOS / Linux
PORT=8080 npm start

# Windows PowerShell
$env:PORT=8080; npm start
```

## How to use

1. Go to **Create a quiz** (`/teacher/new`), add a title, write questions, fill
   in options, and mark the correct one for each question, then **Save quiz**.
2. From the home page, pick a quiz and click **Take quiz**.
3. Choose an answer for each question and **Submit answers** to see your score.

## Project structure

```
server.js            Express app, routes, validation, and grading logic
db.js                SQLite connection + schema bootstrap
views/               EJS templates (home, take quiz, result, teacher form)
public/              Static CSS and the quiz-builder client script
quiz.db              SQLite database file (auto-created, git-ignored)
```

## API (used by the quiz builder UI)

- `POST /teacher/quizzes` — create a quiz.
  Body:
  ```json
  {
    "title": "Geography Basics",
    "questions": [
      {
        "text": "Capital of France?",
        "options": [
          { "text": "Paris",  "isCorrect": true },
          { "text": "Madrid", "isCorrect": false }
        ]
      }
    ]
  }
  ```
  Each question must have at least two options and exactly one correct answer.

## Data model

- `quizzes` — `id`, `title`, `created_at`
- `questions` — `id`, `quiz_id`, `text`, `position`
- `options` — `id`, `question_id`, `text`, `is_correct`, `position`
