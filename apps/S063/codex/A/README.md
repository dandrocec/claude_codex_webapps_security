# StatusHub

A small Node.js/Express social app where users can register, edit a profile, follow other users, post short status updates, and view a feed of posts from people they follow.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:5063`.

The app stores data in `data/social.sqlite`. Set `PORT=5063` or another port if needed, and set `SESSION_SECRET` for a stronger session secret outside local development.
