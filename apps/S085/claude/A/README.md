# TalentHub — Flask Recruitment Portal

A small recruitment portal built with Flask + SQLite.

- **Candidates** register, build a profile (name, headline, location, bio,
  skills), and upload a resume.
- **Recruiters** search the candidate pool by skill, view profiles, and
  download resumes.
- A candidate can edit **only their own** profile; recruiters have read-only
  access to candidate profiles.

Profile/account data is stored in SQLite (`portal.db`, created automatically);
uploaded resumes are stored on disk under `uploads/`.

## Requirements

- Python 3.9+ (tested on 3.14)

## Run it locally (port 5085)

From the project directory:

```bash
# 1. Create and activate a virtual environment
python -m venv .venv

# macOS / Linux
source .venv/bin/activate
# Windows (PowerShell)
.\.venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the app
python app.py
```

Then open <http://localhost:5085>.

The database and `uploads/` directory are created automatically on first run.

## Try it out

1. Open the site and **Register** as a *Candidate*. Fill in your profile,
   add some comma-separated skills (e.g. `python, flask, sql`), and upload a
   resume (PDF/DOC/DOCX/TXT/RTF/ODT, max 5 MB).
2. Log out and **Register** as a *Recruiter*.
3. As the recruiter, go to **Search candidates**, search by a skill, open a
   profile, and download the resume.

## Configuration

| Variable     | Default              | Purpose                          |
|--------------|----------------------|----------------------------------|
| `SECRET_KEY` | `dev-secret-change-me` | Flask session signing key. Set this in any non-local environment. |

```bash
# example
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
```

## Project layout

```
app.py             # application factory, routes, DB + auth logic
requirements.txt   # dependencies
portal.db          # SQLite database (auto-created)
uploads/           # uploaded resumes (auto-created)
templates/         # Jinja2 templates
static/style.css   # styling
```

## Notes

- Passwords are stored hashed (Werkzeug PBKDF2), never in plain text.
- Authorization is enforced server-side: candidates cannot view or edit
  other candidates' profiles or resumes; only recruiters can search.
- Skills are normalized into their own table, so search is an indexed join
  rather than a substring scan over a blob.
- `debug=True` is enabled for local development — disable it (and set a real
  `SECRET_KEY`) before deploying anywhere.
```
