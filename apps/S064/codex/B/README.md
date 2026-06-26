# Flask Project Board

A small Flask project-management app backed by SQLite. Users can register, create projects, invite members by username, and manage tasks on a todo / doing / done board.

## Run locally on port 5064

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY="replace-with-a-long-random-secret"
$env:DATABASE_PATH="project_board.sqlite3"
$env:SESSION_COOKIE_SECURE="false"
flask --app app run --host 127.0.0.1 --port 5064
```

On macOS/Linux:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export SECRET_KEY="replace-with-a-long-random-secret"
export DATABASE_PATH="project_board.sqlite3"
export SESSION_COOKIE_SECURE="false"
flask --app app run --host 127.0.0.1 --port 5064
```

`SESSION_COOKIE_SECURE` defaults to `true` for HTTPS deployments. Set it to `false` only when testing over plain local HTTP.
