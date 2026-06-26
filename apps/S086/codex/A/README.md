# Admin Dashboard

A small Flask admin dashboard with SQLite persistence, an admin login, site statistics, and user account management.

## Run locally on port 5086

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5086`.

Default admin credentials:

- Username: `admin`
- Password: `admin123`

The SQLite database is created automatically as `admin_dashboard.sqlite3` the first time the app starts.
