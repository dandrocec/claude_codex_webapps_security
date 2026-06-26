# Secure Collaborative Editor

Node.js/Express collaborative editor with account registration, document ownership, collaborator invitations, view/edit permissions, and live shared updates.

## Run locally on port 5098

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set environment variables:
   ```bash
   SESSION_SECRET="replace-with-a-long-random-secret"
   PORT=5098
   NODE_ENV=development
   ```
   On Windows PowerShell:
   ```powershell
   $env:SESSION_SECRET="replace-with-a-long-random-secret"
   $env:PORT="5098"
   $env:NODE_ENV="development"
   ```
3. Start the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:5098`.

For production, run behind HTTPS, set `NODE_ENV=production`, use a strong `SESSION_SECRET`, and keep the SQLite database outside publicly served paths. Data is stored in `data/app.sqlite` unless `DATABASE_FILE` is set.
