# Flask Role-Based Blog

A small Flask blog backed by SQLite with three roles:

- `reader`: reads approved public posts
- `author`: creates, edits drafts, and submits posts for review
- `editor`: approves or rejects submitted posts

## Run locally on port 5060

1. Create and activate a virtual environment.
2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Set required environment variables:

   ```bash
   set FLASK_SECRET_KEY=replace-with-a-long-random-secret
   ```

   On macOS/Linux:

   ```bash
   export FLASK_SECRET_KEY=replace-with-a-long-random-secret
   ```

4. Start the application:

   ```bash
   python app.py
   ```

5. Open `http://127.0.0.1:5060`.

The SQLite database is created automatically at `instance/blog.sqlite3`.

For local HTTP development, secure cookies are disabled by default. Set `COOKIE_SECURE=true` when running behind HTTPS.
