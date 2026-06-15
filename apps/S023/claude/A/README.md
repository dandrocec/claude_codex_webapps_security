# Flask Pastebin

A minimal pastebin. Submit a block of text and get back a unique URL; visiting
that URL shows the stored text. Pastes are persisted in a local SQLite database.

## Requirements

- Python 3.8+

## Run locally

1. (Optional) Create and activate a virtual environment:

   ```bash
   python -m venv venv
   # Windows (PowerShell)
   venv\Scripts\Activate.ps1
   # macOS / Linux
   source venv/bin/activate
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Start the app:

   ```bash
   python app.py
   ```

4. Open http://localhost:5023 in your browser.

The app listens on port **5023**. Pastes are stored in `pastes.db`, which is
created automatically next to `app.py` on first run.

## How it works

- `GET /` — shows the new-paste form.
- `POST /` — stores the submitted text under a freshly generated unique id and
  redirects to its URL.
- `GET /<paste_id>` — displays the stored paste (404 if it doesn't exist).
