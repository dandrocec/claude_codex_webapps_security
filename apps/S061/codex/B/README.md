# SecureLearn

A Node.js/Express e-learning app with instructor and student roles. Instructors create courses and lessons. Students enrol in courses and mark lessons complete. Lesson content is visible only to enrolled students and the instructor who owns the course.

## Run locally on port 5061

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an environment file:

   ```bash
   cp .env.example .env
   ```

3. Set `SESSION_SECRET` in `.env` to a strong random value of at least 32 characters.

4. Start the app:

   ```bash
   npm start
   ```

5. Open `http://localhost:5061`.

For plain HTTP local development, `.env.example` sets `COOKIE_SECURE=false` so browser sessions work without TLS. Use secure cookies in production by removing that override and serving the app over HTTPS.
