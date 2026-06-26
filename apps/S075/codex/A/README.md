# Express Quiz Platform

A Node.js/Express quiz platform backed by SQLite. Teachers can create multiple-choice quizzes with correct answers, and students can take quizzes and receive an automatically calculated score after submission. Student quiz pages only include question text and answer choices, so correct answers are not exposed before submission.

## Run locally

```bash
npm install
npm start
```

The app runs at:

```text
http://localhost:5075
```

Set `PORT=5075` explicitly if your environment overrides the default port.
