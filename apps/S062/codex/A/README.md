# Flask Helpdesk

A small Flask helpdesk backed by SQLite. Customers can register, open tickets, and add replies. Agents can view every ticket, assign ownership, change status, and reply.

## Run locally on port 5062

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5062 in your browser.

The app creates `helpdesk.sqlite3` automatically on first request. A demo agent account is seeded:

- Email: `agent@example.com`
- Password: `password`
