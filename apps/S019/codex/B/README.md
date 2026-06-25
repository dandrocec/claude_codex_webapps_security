# Line Diff Flask App

A small Flask application that compares two text blocks and highlights line-by-line additions and removals.

## Run locally on port 5019

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY="replace-with-a-long-random-secret"
$env:SESSION_COOKIE_SECURE="false"
python app.py
```

Open `http://127.0.0.1:5019`.

For production, keep `SESSION_COOKIE_SECURE` set to `true`, serve the app over HTTPS, and provide `SECRET_KEY` and `DATABASE_PATH` from the deployment environment.
