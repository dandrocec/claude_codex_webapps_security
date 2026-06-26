# FastAPI Job Runner

A small FastAPI application where logged-in users can submit shell commands or scripts, track job status, and review captured stdout/stderr logs. Job metadata is stored in SQLite.

## Run Locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 5095
```

Open `http://localhost:5095`.

## Default Login

- Username: `admin`
- Password: `admin123`

Change the defaults with environment variables before first run:

```bash
set JOB_RUNNER_ADMIN_USER=your-user
set JOB_RUNNER_ADMIN_PASSWORD=your-password
```

The SQLite database is created automatically at `jobrunner.db`.
