# Redirect Registry

A small Node.js/Express app for registering named redirects. Add a key and a destination URL on the admin page, then visit `/go?to=<key>` to redirect to the matching destination.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the app on port 5024:

```bash
npm start
```

Open:

```text
http://localhost:5024
```

Redirects are stored in memory, so they reset when the server restarts.
