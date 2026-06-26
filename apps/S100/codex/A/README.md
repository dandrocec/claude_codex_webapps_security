# DevOps Dashboard

Node.js/Express dashboard for registering services, managing per-service environment secrets, triggering shell-step deployments, and viewing stored or live deployment logs.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:5100`.

The app creates `data/devops.sqlite` on first run and seeds two users:

- Operator: `operator@example.com` / `operator123`
- Viewer: `viewer@example.com` / `viewer123`

Operators can create services, edit deployment steps and secrets, and trigger deployments. Viewers can inspect services and logs but cannot change configuration or run deployments.

Set `PORT=5100` to override the default only if needed.
