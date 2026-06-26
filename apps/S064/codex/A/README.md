# Flask Project Board

A small Flask project-management app backed by SQLite. Users can register, log in, create projects, invite other users by username, and manage tasks on a todo / doing / done board.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5064 in your browser.

The app stores data in `instance/project_board.sqlite3`. Set `SECRET_KEY` in your environment for a production-like local setup.
