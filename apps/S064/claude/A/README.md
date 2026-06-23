# TaskBoard — Flask Project Management

A small Flask app for managing projects and tasks on a kanban board.

## Features

- **Accounts** — register and log in (passwords are hashed).
- **Projects** — any logged-in user can create projects; the creator becomes the owner and first member.
- **Members** — invite other registered users to a project by username or email.
- **Tasks** — add tasks with a title, description, and assignee; move them across the
  **todo / doing / done** board and delete them.
- **Access control** — only project members can view or change a project, its members,
  and its tasks. Non-members get a `403 Forbidden`.
- **Storage** — SQLite (`pm.db`), created automatically on first run.

## Requirements

- Python 3.9+

## Run locally (port 5064)

```bash
# 1. Create and activate a virtual environment
python -m venv venv
# Windows (PowerShell)
venv\Scripts\Activate.ps1
# macOS / Linux
source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the app
python app.py
```

Then open <http://127.0.0.1:5064> in your browser.

The SQLite database (`pm.db`) is created automatically in the project directory on first
launch. Delete that file to reset all data.

## Quick start

1. Register two accounts (e.g. `alice` and `bob`) — open in two browsers or use a private window for the second.
2. As `alice`, create a project and open its board.
3. Invite `bob` by entering his username or email under **Members**.
4. Add tasks, assign them to members, and drag them through the board by changing status.

## Project layout

```
app.py            # Flask app, routes, and access control
models.py         # SQLAlchemy models (User, Project, Task, membership table)
templates/        # Jinja2 templates
requirements.txt  # Python dependencies
```
