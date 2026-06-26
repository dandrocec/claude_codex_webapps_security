# FastAPI Microblog

A small FastAPI microblog with session authentication, following, per-user feeds, link previews, SQLAlchemy storage, and Redis/RQ background jobs.

## Run locally on port 5091

1. Create and activate a Python virtual environment.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Start Redis locally.
4. Set environment variables:
   ```bash
   set SECRET_KEY=replace-with-a-long-random-secret
   set DATABASE_URL=sqlite:///./microblog.db
   set REDIS_URL=redis://localhost:6379/0
   set SESSION_COOKIE_SECURE=false
   ```
   Use `SESSION_COOKIE_SECURE=true` behind HTTPS.
5. Start the web app:
   ```bash
   uvicorn app.main:app --host 127.0.0.1 --port 5091
   ```
6. In another terminal, start the worker:
   ```bash
   rq worker microblog --url redis://localhost:6379/0
   ```

Open `http://127.0.0.1:5091`.

The REST API is under `/api`. API clients should first call `GET /api/csrf` and send the returned token as `X-CSRF-Token` on every state-changing request.
