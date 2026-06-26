# Express API Gateway

A local Node.js/Express API gateway with developer registration, generated API keys, per-key rate limits, request proxying, SQLite usage storage, and a browser dashboard.

## Run locally

```bash
npm install
npm start
```

The server listens on port `5096` by default:

```text
http://localhost:5096
```

Set `PORT`, `DATABASE_PATH`, or `JWT_SECRET` in the environment to override the defaults.

## How to use

1. Open `http://localhost:5096`.
2. Register a developer account or log in.
3. Generate an API key with a backend URL and per-minute rate limit.
4. Send gateway traffic to `/proxy/...` with the generated key in the `x-api-key` header.

Example:

```bash
curl -H "x-api-key: gw_live_your_key_here" http://localhost:5096/proxy/users
```

If the key is configured with backend `https://api.example.com`, that request is forwarded to `https://api.example.com/users`. Usage records and rate-limit events appear on the dashboard.
