# Flask Support Tickets

A small Flask support-ticket application backed by SQLite. Users can register, log in, submit tickets with a subject, description, and priority, then view the status of their own tickets.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open <http://127.0.0.1:5052>.

The app creates `tickets.db` automatically on first run. Set `SECRET_KEY` and `DATABASE_PATH` environment variables if you want to override the defaults.
