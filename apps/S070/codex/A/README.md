# Flask Recruiting App

A small recruiting portal backed by SQLite. Employers can post jobs and review only the applications for their own jobs. Applicants can browse jobs, apply with a resume upload, and see only their own submissions.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://localhost:5070 in your browser.

The app creates `recruiting.sqlite3` and an `uploads/` directory automatically on first use.
