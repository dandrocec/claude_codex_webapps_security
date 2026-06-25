# Flask Pastebin

A minimal Flask pastebin backed by SQLite. Submit a block of text on the home page and the app stores it with a unique URL at `/p/<id>`.

## Run locally

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5023 in your browser.

The SQLite database is created automatically as `pastes.db`. Set `PASTEBIN_DATABASE` to use a different database path.
