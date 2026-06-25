# Temperature Converter

A Flask web app for converting Celsius to Fahrenheit and Fahrenheit to Celsius. Signed-in users can keep a private conversion history.

## Run locally on port 5004

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-local-secret"
$env:SESSION_COOKIE_SECURE = "false"
python app.py
```

Open http://127.0.0.1:5004.

For production, set `SECRET_KEY` from a secret manager or environment variable and leave `SESSION_COOKIE_SECURE=true` behind HTTPS.
