# Flask Membership Site

Small Flask membership app with free and premium tiers, SQLite persistence, tier-aware navigation, premium-only content, and an admin user-management page.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5072

The SQLite database is created automatically as `membership.sqlite3` on first run.

## Seed accounts

| Email | Password | Role / Tier |
| --- | --- | --- |
| admin@example.com | admin123 | Admin, Premium |
| premium@example.com | premium123 | Member, Premium |
| free@example.com | free123 | Member, Free |

