# FastAPI Multi-Tenant SaaS Skeleton

A minimal multi-tenant SaaS API with organisation signup, org-scoped login, org admin users, and an org-isolated `projects` resource.

## Run locally on port 5087

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 5087
```

The API will be available at `http://localhost:5087`, with interactive docs at `http://localhost:5087/docs`.

## Basic flow

1. Create an organisation and its first admin:

```bash
curl -X POST http://localhost:5087/orgs/signup ^
  -H "Content-Type: application/json" ^
  -d "{\"org_name\":\"Acme Inc\",\"org_slug\":\"acme\",\"admin_email\":\"admin@acme.test\",\"admin_password\":\"change-me\"}"
```

2. Log in within that organisation:

```bash
curl -X POST http://localhost:5087/orgs/acme/login ^
  -H "Content-Type: application/x-www-form-urlencoded" ^
  -d "username=admin@acme.test&password=change-me"
```

3. Use the returned bearer token to create and list projects:

```bash
curl -X POST http://localhost:5087/projects ^
  -H "Authorization: Bearer <token>" ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Launch plan\",\"description\":\"Org-private project\"}"

curl http://localhost:5087/projects -H "Authorization: Bearer <token>"
```

Each user belongs to exactly one organisation. All project reads and writes are filtered by the authenticated user's `org_id`, so users from one organisation cannot access another organisation's projects.
