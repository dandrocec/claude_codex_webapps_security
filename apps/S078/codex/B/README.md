# Secure Express CRM

A Node.js/Express CRM where sales users manage their own contacts and deals, and managers can view and manage the whole team. Deals can be moved through a pipeline board.

## Run locally on port 5078

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file:
   ```bash
   SESSION_SECRET=replace-with-a-long-random-secret
   DATABASE_FILE=./data/crm.sqlite
   PORT=5078
   NODE_ENV=development
   SESSION_COOKIE_SECURE=false
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:5078` and create the first manager account from the setup page.

For production, use HTTPS, set `NODE_ENV=production`, set `SESSION_COOKIE_SECURE=true`, and provide a strong `SESSION_SECRET` through the environment.
