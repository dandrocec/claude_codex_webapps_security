# FastAPI Job Runner

A small web app where logged-in users submit a shell command or script, the
server executes it in the background, captures the output, and shows a history
of jobs with their status and live logs. Job metadata is stored in SQLite.

## Features

- Session-based login (PBKDF2-hashed passwords, no native build deps).
- Submit any shell command/script; runs server-side in a bounded thread pool.
- Live-updating logs and status (`pending → running → success/failed`) per job.
- Job history with command, status, who ran it, and timestamps.
- Output capped at 1 MB and jobs killed after a 5-minute timeout.
- Pure stdlib persistence (`sqlite3`) — the database file is created on startup.

## Requirements

- Python 3.10+

## Run locally on port 5095

```bash
# 1. (optional) create a virtual environment
python -m venv .venv
# Windows:        .venv\Scripts\activate
# macOS / Linux:  source .venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the server on port 5095
uvicorn main:app --host 127.0.0.1 --port 5095
```

Then open <http://127.0.0.1:5095> in your browser.

On first run a default user is created and printed to the console:

```
username: admin
password: admin
```

Override the seed credentials (and harden the session) with environment
variables before starting:

```bash
# Windows (PowerShell)
$env:ADMIN_USERNAME="alice"; $env:ADMIN_PASSWORD="s3cret"; $env:SESSION_SECRET="<random hex>"

# macOS / Linux
export ADMIN_USERNAME=alice ADMIN_PASSWORD=s3cret SESSION_SECRET=$(openssl rand -hex 32)
```

The default user is only seeded when the database has no users, so changing the
env vars after first run has no effect — delete `jobrunner.db` to re-seed.

## Project layout

| File              | Purpose                                            |
| ----------------- | -------------------------------------------------- |
| `main.py`         | FastAPI app, routes, auth, startup seeding         |
| `runner.py`       | Background command execution + output capture      |
| `database.py`     | SQLite schema and queries (stdlib only)            |
| `security.py`     | PBKDF2 password hashing/verification               |
| `templates/`      | Jinja2 HTML (login, job list, job detail)          |
| `jobrunner.db`    | SQLite database (auto-created, git-ignored)        |

## ⚠️ Security notice — please read

**This application executes arbitrary commands on the host by design.** That is
the purpose of a job runner, but it means anyone who can log in effectively has
a remote shell with the privileges of the server process.

For that reason:

- It binds to `127.0.0.1` (localhost) in the instructions above. **Do not expose
  it to a network or the internet** without putting it behind authentication you
  trust, network controls, and ideally per-job sandboxing (containers, a
  dedicated low-privilege user, resource limits).
- Change the default `admin/admin` credentials immediately.
- Set a fixed `SESSION_SECRET` in any real deployment (otherwise sessions reset
  on every restart).
- Run the server as an unprivileged user, never as root/Administrator.

Treat this as a local/trusted-environment tool unless you add the hardening
above.
