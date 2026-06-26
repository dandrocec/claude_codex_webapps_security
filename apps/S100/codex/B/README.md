# DevOps Dashboard

Node.js/Express dashboard for registering services, managing per-service encrypted environment secrets, triggering shell-step deployments, and viewing stored/streamed deployment logs.

## Run locally on port 5100

1. Install dependencies:
   ```sh
   npm install
   ```
2. Set required secrets:
   ```sh
export SESSION_SECRET="replace-with-a-long-random-session-secret"
export APP_ENCRYPTION_KEY="replace-with-a-long-random-encryption-key"
export OPERATOR_REGISTRATION_TOKEN="replace-with-a-random-operator-invite-token"
export COOKIE_SECURE="false"
   ```
   PowerShell equivalent:
   ```powershell
$env:SESSION_SECRET="replace-with-a-long-random-session-secret"
$env:APP_ENCRYPTION_KEY="replace-with-a-long-random-encryption-key"
$env:OPERATOR_REGISTRATION_TOKEN="replace-with-a-random-operator-invite-token"
$env:COOKIE_SECURE="false"
   ```
3. Start the app:
   ```sh
   npm start
   ```
4. Open `http://localhost:5100`.

Use `COOKIE_SECURE=true` behind HTTPS in production. The first registered account may choose `operator`; later operator registrations require `OPERATOR_REGISTRATION_TOKEN`. Operators can create services, manage secrets, and deploy. Viewers can only read their own dashboard data.
