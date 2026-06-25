# Password Strength Checker

Node.js/Express app that lets a signed-in user submit a candidate password and receive a weak, medium, or strong rating with brief improvement feedback.

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set a session secret of at least 32 characters:

   ```bash
   set SESSION_SECRET=replace-with-a-long-random-secret-value
   ```

   PowerShell:

   ```powershell
   $env:SESSION_SECRET="replace-with-a-long-random-secret-value"
   ```

3. Start the app on port 5018:

   ```bash
   npm start
   ```

4. Open `https://localhost:5018`.

The app serves HTTPS on port 5018. If `TLS_KEY_PATH` and `TLS_CERT_PATH` are not set, it creates a temporary self-signed local certificate at startup, so your browser may show a local certificate warning. The app stores its SQLite database files under `data/` when it starts.
