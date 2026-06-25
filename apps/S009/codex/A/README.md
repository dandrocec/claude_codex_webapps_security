# Express URL Shortener

A small Node.js and Express URL shortener that stores links in memory for the current server session.

## Run locally

Install dependencies:

```bash
npm install
```

Start the app on port 5009:

```bash
npm start
```

Open:

```text
http://localhost:5009
```

You can also set a custom port:

```bash
PORT=5009 npm start
```

## Notes

- URL mappings are stored in memory and reset when the server restarts.
- Visiting `/<code>` redirects to the original URL.
- The home page lists all short codes created during the current session.
