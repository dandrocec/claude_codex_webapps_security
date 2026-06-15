# Named Redirects

A small Express app for managing named redirects. An admin registers a **key**
and a **destination URL**; visitors hitting `/go?to=<key>` are sent to the
matching destination. All registered redirects are listed on the home page.

## Requirements

- Node.js 18 or newer (uses the built-in `URL` parser)

## Run locally

```bash
npm install
npm start
```

The app listens on **http://localhost:5024**.

To use a different port:

```bash
PORT=8080 npm start
```

On Windows PowerShell:

```powershell
$env:PORT=8080; npm start
```

## Routes

| Route             | Method | Purpose                                            |
| ----------------- | ------ | -------------------------------------------------- |
| `/`               | GET    | List all registered redirects                      |
| `/admin`          | GET    | Admin form to register a redirect                  |
| `/admin`          | POST   | Save a new (or updated) redirect                   |
| `/go?to=<key>`    | GET    | Redirect the visitor to the destination for `key`  |

## Try it

1. Open <http://localhost:5024/admin>.
2. Register a key (e.g. `docs`) with a destination (e.g. `https://nodejs.org`).
3. Visit <http://localhost:5024/go?to=docs> — you'll be redirected.
4. The home page lists everything registered.

## Notes

- Redirects are stored **in memory**, so they reset when the server restarts.
  Swap the `Map` in `server.js` for a database to persist them.
- Destinations are restricted to `http(s)` URLs, and all user-supplied text is
  HTML-escaped when rendered.
