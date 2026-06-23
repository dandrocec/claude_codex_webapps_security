# Microblog

A small but complete microblogging service built with **FastAPI**.

Users post messages, follow each other, and read a personal timeline. A
**background worker** drains a durable task queue to:

1. **fan out** each new post into every follower's timeline (fan-out-on-write), and
2. **fetch link previews** (OpenGraph title/description/image) for any URLs in a post.

It ships with a REST API and a minimal single-page UI.

## Architecture

| Concern        | Choice                                                                 |
| -------------- | --------------------------------------------------------------------- |
| Web framework  | FastAPI + Uvicorn                                                      |
| Database       | SQLite via SQLAlchemy (file `microblog.db`, WAL mode — zero setup)    |
| Task queue     | A `tasks` table in the database (durable, no Redis/broker required)    |
| Worker         | Polling loop in `app/worker.py` — runs in-process **or** standalone   |
| UI             | Server-rendered page (`app/templates/index.html`) calling the REST API |

Why a DB-backed queue? It keeps the project **fully runnable with one `pip install`**
and no external services, while still demonstrating the producer/worker split: the
API enqueues tasks, the worker consumes them, retries on failure (up to 3x), and
marks them `done`/`failed`.

```
POST /api/posts ──► enqueue(fanout_post) + enqueue(fetch_link_preview)
                         │
                    tasks table  ◄──── polled by worker
                         │
        ┌────────────────┴─────────────────┐
   feed_items (timelines)          link_previews
```

## Requirements

- Python 3.10+

## Run it locally (port 5091)

```bash
# 1. (optional) create a virtualenv
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux:  source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app (the background worker runs in-process by default)
uvicorn app.main:app --host 0.0.0.0 --port 5091
```

Then open <http://localhost:5091>.

The database is created automatically and seeded with three demo users
(`alice`, `bob`, `carol`).

### Running the worker as a separate process (optional)

The worker runs inside the API process by default (`RUN_WORKER_INLINE=1`).
To run it standalone — closer to a production deployment — disable the inline
worker and start it yourself in a second terminal:

```bash
# terminal 1 — API only
# Windows PowerShell:  $env:RUN_WORKER_INLINE = "0"
# macOS/Linux:         export RUN_WORKER_INLINE=0
uvicorn app.main:app --host 0.0.0.0 --port 5091

# terminal 2 — worker
python -m app.worker
```

## REST API

| Method & path                              | Description                          |
| ------------------------------------------ | ------------------------------------ |
| `POST /api/users`                          | Create a user `{ "username": "..." }`|
| `GET  /api/users`                          | List users                           |
| `GET  /api/users/{id}`                     | Get a user                           |
| `GET  /api/users/{id}/following`           | Users this user follows              |
| `POST /api/users/{id}/follow`              | Follow `{ "target_id": N }`          |
| `DELETE /api/users/{id}/follow/{target}`   | Unfollow                             |
| `POST /api/posts`                          | Create `{ "author_id": N, "content": "..." }` |
| `GET  /api/posts/{id}`                      | Get a post (with link previews)      |
| `GET  /api/users/{id}/posts`               | A user's own posts                   |
| `GET  /api/timeline/{id}?limit=50`         | A user's materialized timeline       |
| `GET  /healthz`                            | Health check                         |

Interactive API docs (Swagger UI) are available at
<http://localhost:5091/docs>.

### Quick example

```bash
# create a post (author_id 1 = alice from the seed data)
curl -X POST http://localhost:5091/api/posts \
  -H "Content-Type: application/json" \
  -d '{"author_id": 1, "content": "Hello world! https://www.python.org"}'

# read alice's timeline (worker fans the post out within ~1s)
curl http://localhost:5091/api/timeline/1
```

## Notes

- Link previews are fetched asynchronously, so a brand-new post shows
  `status: "pending"` previews until the worker finishes (the UI auto-refreshes).
- There is no authentication — the UI's "Acting as" selector simply chooses which
  user id to send. This keeps the demo focused on the timeline/queue mechanics.
- Delete `microblog.db` (and the `-wal`/`-shm` files) to reset all data.
