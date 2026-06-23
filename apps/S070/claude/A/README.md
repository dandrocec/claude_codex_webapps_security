# Recruit — a tiny Flask recruiting app

Employers post jobs and review the applications submitted to them. Applicants
browse jobs, apply with a cover letter, and upload a resume. Data lives in a
local SQLite database; uploaded resumes are stored on disk.

## Access rules

- **Employers** see only the jobs they posted and the applications submitted to
  *those* jobs.
- **Applicants** see only their own submissions.
- A resume can be downloaded only by the applicant who uploaded it or by the
  employer who owns the job it was submitted to. Every other request gets a 403.

## Run it locally (port 5070)

You need Python 3.9+.

```bash
# 1. (optional) create a virtual environment
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

# 2. install dependencies
pip install -r requirements.txt

# 3. start the app
python app.py
```

Then open <http://127.0.0.1:5070> in your browser.

The SQLite database (`recruiting.db`) and the `uploads/` directory are created
automatically on first run.

### Trying it out

1. Sign up once as an **Employer** and post a job.
2. Log out, sign up again as an **Applicant** (use a different email), open the
   job, and apply with a resume file.
3. Log back in as the employer and open **Review applications** on your job to
   see the submission and download the resume.

## Configuration

- `SECRET_KEY` — set this environment variable in production to keep sessions
  secure. A development default is used otherwise.

## Project layout

```
app.py          # app factory, routes, auth, uploads
models.py       # SQLAlchemy models: User, Job, Application
templates/      # Jinja2 templates
requirements.txt
```

## Notes

- Passwords are hashed with Werkzeug (`generate_password_hash`); they are never
  stored in plaintext.
- Uploaded files are renamed to a random name on disk and limited to 5 MB and a
  small allow-list of document extensions.
- `debug=True` is enabled for convenience while running locally; turn it off for
  any real deployment.
