# Contact Form Preview App

A small Flask web app with a public contact form and an admin page for reviewing submitted messages.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://localhost:5044 in your browser.

The admin page is available at http://localhost:5044/admin.

Submissions are stored in a local SQLite database file named `contacts.db`, created automatically on first run.
