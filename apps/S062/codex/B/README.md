# Flask Helpdesk

A small SQLite-backed helpdesk application. Customers can register, open tickets, and reply to their own tickets. Agents can view every ticket, assign tickets, change status, and reply.

## Run locally on port 5062

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "replace-with-a-long-random-secret"
flask --app app init-db
$env:AGENT_EMAIL = "agent@example.com"
$env:AGENT_PASSWORD = "replace-with-a-strong-agent-password"
$env:AGENT_NAME = "Support Agent"
flask --app app create-agent
flask --app app run --host 127.0.0.1 --port 5062
```

Open `http://127.0.0.1:5062`.

## Notes

- `SECRET_KEY` is required and must be supplied through the environment.
- The default SQLite database file is `helpdesk.sqlite3`. Set `DATABASE_URL` to use another SQLite file path.
- Session cookies are configured as `HttpOnly`, `Secure`, and `SameSite=Lax`; use HTTPS for non-local deployments.
