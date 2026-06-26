# Secure Express Quiz Platform

A Node.js/Express quiz platform where teachers create multiple-choice quizzes and students submit answers for automatic scoring. Correct answers are only queried during server-side grading and are not rendered in the student quiz form.

## Run locally on port 5075

1. Install Node.js 18 or newer.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file:
   ```bash
   SESSION_SECRET=replace-with-at-least-32-random-characters
   PORT=5075
   DATABASE_FILE=quiz.sqlite
   SESSION_COOKIE_SECURE=false
   ```
   Use `SESSION_COOKIE_SECURE=true` when serving over HTTPS.
4. Start the app:
   ```bash
   npm start
   ```
5. Open `http://localhost:5075`.

## Security notes

- Passwords are hashed with bcrypt and a configurable work factor.
- SQL access uses parameterized queries.
- All state-changing forms include CSRF tokens.
- User input is validated server-side; EJS escaped output is used for rendered content.
- Teacher quiz detail pages are scoped to the owning teacher, and student grading is done server-side.
- Helmet sets security headers, session cookies are HttpOnly/SameSite, and error responses do not expose stack traces.
- Secrets are read from environment variables and are not hardcoded.
