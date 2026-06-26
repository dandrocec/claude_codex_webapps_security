# Flask Recruitment Portal

A small Flask recruitment portal with candidate profiles, resume uploads, and recruiter search.

## Local setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5085 in your browser.

The app stores SQLite data in `instance/recruitment.db` and uploaded resumes in `instance/resumes/`.

## Roles

- Candidates can register, create or edit their own profile, and upload a resume.
- Recruiters can register as recruiters, search candidates by skill, and view candidate profiles and resumes.
