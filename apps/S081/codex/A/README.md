# Flask Voting Platform

A small SQLite-backed voting platform. Admins can create elections with candidates and open/close times, registered users can cast one vote per election, and results are visible only after an election closes.

## Run locally on port 5081

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5081 in your browser.

On first startup the app creates `voting.db` and a default admin account:

- Username: `admin`
- Password: `admin123`

Change the admin password after logging in if you adapt this for real use.
