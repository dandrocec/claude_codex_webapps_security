# FastAPI Microblog

A small FastAPI microblog with users, posts, follows, generated per-user timelines, and background link preview fetching.

## Run locally on port 5091

1. Create a virtual environment and install dependencies:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. Start Redis for the task queue:

   ```bash
   docker run --rm -p 6379:6379 redis:7
   ```

3. In a second terminal, start the worker:

   ```bash
   .venv\Scripts\activate
   rq worker microblog --url redis://localhost:6379/0
   ```

4. In a third terminal, start the web app:

   ```bash
   .venv\Scripts\activate
   uvicorn app.main:app --host 0.0.0.0 --port 5091
   ```

Open `http://localhost:5091`.

## REST API

- `POST /api/users` with `{"username": "alice", "display_name": "Alice"}`
- `GET /api/users`
- `POST /api/posts` with `{"user_id": 1, "body": "hello https://example.com"}`
- `GET /api/posts`
- `POST /api/follows` with `{"follower_id": 1, "followee_id": 2}`
- `DELETE /api/follows/{follower_id}/{followee_id}`
- `GET /api/timeline/{user_id}`
- `POST /api/feeds/rebuild/{user_id}`

The SQLite database is stored at `microblog.db` by default. Override with `DATABASE_URL`; override Redis with `REDIS_URL`.
