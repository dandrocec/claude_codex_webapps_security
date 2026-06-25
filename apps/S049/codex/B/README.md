# Flask Newsletter Manager

A small Flask app for logged-in editors to manage subscribers and newsletter drafts stored in SQLite. Drafts include a subject, body, and HTML preview.

## Run locally on port 5049

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
python app.py
```

Open `http://127.0.0.1:5049`.

For production behind HTTPS, keep `SECRET_KEY` in the environment and serve the app through a WSGI server. Secure cookies are enabled, so local browser testing may require HTTPS support or setting up a local HTTPS proxy.
