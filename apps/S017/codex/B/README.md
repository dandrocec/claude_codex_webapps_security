# Flask Currency Converter

A small Flask app that converts an amount between a fixed list of currencies using hard-coded exchange rates.

## Run locally on port 5017

1. Create and activate a virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Set a secret key environment variable:

```bash
# macOS/Linux
export SECRET_KEY="replace-with-a-long-random-value"

# Windows PowerShell
$env:SECRET_KEY="replace-with-a-long-random-value"
```

For local HTTP testing on `127.0.0.1`, also disable the secure-cookie flag:

```bash
# macOS/Linux
export SESSION_COOKIE_SECURE=false

# Windows PowerShell
$env:SESSION_COOKIE_SECURE="false"
```

4. Start the app:

```bash
python app.py
```

5. Open `http://127.0.0.1:5017`.

Secure, HttpOnly, SameSite session cookies are enabled by default. Keep `SESSION_COOKIE_SECURE=true` when running behind HTTPS.
