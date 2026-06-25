# Flask Newsroom

A small Flask news site backed by SQLite. Authors can register, log in, publish, edit, and delete their own articles. Visitors can read articles and post comments below each article.

## Run locally on port 5042

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
$env:SESSION_COOKIE_SECURE = "0"
python app.py
```

Open `http://127.0.0.1:5042`.

For production, serve the app behind HTTPS, keep `SESSION_COOKIE_SECURE=1`, and set `SECRET_KEY` to a high-entropy value from the environment.
