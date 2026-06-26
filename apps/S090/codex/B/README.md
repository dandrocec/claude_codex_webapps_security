# OAuth Profile Express App

This is a Node.js/Express app that signs users in with a third-party OAuth2 provider, stores sessions and profile data in SQLite, and displays provider account data using the user's access token.

## Run locally on port 5090

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file:

   ```env
   PORT=5090
   NODE_ENV=development
   APP_ORIGIN=http://localhost:5090
   SESSION_SECRET=replace-with-a-long-random-session-secret
   SESSION_COOKIE_SECURE=false

   OAUTH_CLIENT_ID=your-client-id
   OAUTH_CLIENT_SECRET=your-client-secret
   OAUTH_AUTHORIZATION_URL=https://provider.example.com/oauth/authorize
   OAUTH_TOKEN_URL=https://provider.example.com/oauth/token
   OAUTH_USERINFO_URL=https://provider.example.com/oauth/userinfo
   OAUTH_ACCOUNT_API_URL=https://provider.example.com/api/account
   OAUTH_CALLBACK_URL=http://localhost:5090/auth/callback
   OAUTH_SCOPE=openid profile email
   ```

3. Configure the same callback URL in your OAuth provider:

   ```text
   http://localhost:5090/auth/callback
   ```

4. Start the app:

   ```bash
   npm start
   ```

5. Open `http://localhost:5090`.

For production, use HTTPS, set `NODE_ENV=production`, set `SESSION_COOKIE_SECURE=true`, and provide strong random secrets through environment variables.
