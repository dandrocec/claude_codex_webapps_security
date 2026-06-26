# FastAPI Job Runner

A small authenticated FastAPI app where users can submit commands or Python scripts, track their own job history, and view captured output.

## Run locally on port 5095

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
export SESSION_COOKIE_SECURE=false
uvicorn app.main:app --host 127.0.0.1 --port 5095
```

On Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(48))"
$env:SESSION_COOKIE_SECURE = "false"
uvicorn app.main:app --host 127.0.0.1 --port 5095
```

Open `http://127.0.0.1:5095`.

`SESSION_COOKIE_SECURE=false` is only for plain HTTP local development. In production, keep secure cookies enabled, use HTTPS, and set a strong `SECRET_KEY`.
