# OAuth Profile Express App

This is a Node.js/Express app that signs users in with GitHub OAuth, stores sessions and basic profile records in SQLite, and shows a personalized account page with data fetched from the GitHub API on the signed-in user's behalf.

## Run Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment file:

   ```bash
   cp .env.example .env
   ```

3. Create a GitHub OAuth app at <https://github.com/settings/developers>.

   Use this callback URL:

   ```text
   http://localhost:5090/auth/github/callback
   ```

4. Put your GitHub client ID and client secret into `.env`.

5. Start the app:

   ```bash
   npm start
   ```

6. Open <http://localhost:5090>.

The app listens on port `5090` by default. A SQLite database is created automatically at `data/app.sqlite`.
