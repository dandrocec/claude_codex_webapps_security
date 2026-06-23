# Express + GitHub OAuth Demo

A small Node.js/Express app that lets users **sign in with GitHub** (OAuth 2.0).
After login it:

- stores a **basic profile** in a database,
- shows a **personalised dashboard**, and
- calls the **GitHub API on the user's behalf** to display live account data
  (public repo / follower counts and recently updated repositories).

**Sessions and profiles are persisted in SQLite** — sessions via
`connect-sqlite3`, profiles via `better-sqlite3`. No external services required.

## Stack

| Concern            | Choice                                  |
| ------------------ | --------------------------------------- |
| Web framework      | Express                                 |
| OAuth              | Passport + `passport-github2`           |
| Session store      | `express-session` + `connect-sqlite3`   |
| Profile store      | `better-sqlite3`                        |
| Views              | EJS                                     |

Database files are created automatically under `./data/`
(`app.sqlite` for profiles, `sessions.sqlite` for sessions).

## Prerequisites

- Node.js **18+** (uses the built-in global `fetch`)
- A GitHub account

## 1. Register a GitHub OAuth App

Go to **https://github.com/settings/developers → New OAuth App** and set:

| Field                       | Value                                       |
| --------------------------- | ------------------------------------------- |
| Application name            | anything, e.g. `Local OAuth Demo`           |
| Homepage URL                | `http://localhost:5090`                     |
| Authorization callback URL  | `http://localhost:5090/auth/github/callback`|

Then **generate a client secret**. You'll get a **Client ID** and **Client Secret**.

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
SESSION_SECRET=some-long-random-string
PORT=5090
BASE_URL=http://localhost:5090
```

## 3. Install & run

```bash
npm install
npm start
```

Open **http://localhost:5090** and click **Sign in with GitHub**.

> On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.

## Routes

| Route                     | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `GET /`                   | Landing / sign-in page                             |
| `GET /auth/github`        | Starts the OAuth flow                              |
| `GET /auth/github/callback` | OAuth redirect target                           |
| `GET /dashboard`          | Personalised page (auth required) + live API data  |
| `POST /logout`            | Clears the session                                 |

## How it works

1. `/auth/github` redirects to GitHub's consent screen.
2. GitHub redirects back to `/auth/github/callback` with an authorization code,
   which Passport exchanges for an **access token**.
3. The Passport verify callback (`auth.js`) upserts the user's basic profile and
   access token into the `users` table (`db.js`).
4. The session stores only the user's row ID; on each request the user is
   rehydrated from the database.
5. `/dashboard` uses the stored access token to call the GitHub REST API
   (`github.js`) and renders live account data.

## Notes

- The OAuth scope requested is `read:user user:email` only — no write access.
- For a real deployment: serve over HTTPS, set `cookie.secure = true`, and keep
  secrets out of source control (`.env` is already git-ignored).
