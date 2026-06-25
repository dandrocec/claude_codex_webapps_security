# Flask Newsletter Manager

A small Flask app for a logged-in editor to manage subscribers, compose newsletter drafts, and preview each draft as an email-style newsletter. Data is stored in a local SQLite database named `newsletter.db`.

## Run locally on port 5049

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5049`.

Default local credentials:

- Username: `editor`
- Password: `newsletter`

Optional environment variables:

- `SECRET_KEY`
- `EDITOR_USERNAME`
- `EDITOR_PASSWORD_HASH` generated with Werkzeug
