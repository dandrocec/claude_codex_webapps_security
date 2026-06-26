# Secure Clinic Portal

Node.js/Express clinic portal with SQLite storage, bcrypt password hashing, CSRF protection, validation, security headers, secure session settings, and role-based access controls for patients, doctors, and receptionists.

## Run locally on port 5092

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a local environment file:
   ```bash
   cp .env.example .env
   ```
3. Set a long random `SESSION_SECRET` in `.env`.
4. Start the app:
   ```bash
   npm start
   ```
5. Open `http://localhost:5092`.

For local HTTP development, `.env.example` sets `COOKIE_SECURE=false`. Use `COOKIE_SECURE=true` behind HTTPS in production.

## Demo accounts

The first run creates demo accounts using `DEMO_PASSWORD` from the environment.

- `patient@example.com` - patient
- `doctor@example.com` - doctor
- `reception@example.com` - receptionist

