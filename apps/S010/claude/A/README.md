# File Upload App (FastAPI)

A small web app to upload files and browse/download them.

- `GET /` — upload form
- `POST /upload` — saves the file to `uploads/`, then redirects to the list
- `GET /files` — lists uploaded files with download links
- `GET /uploads/<name>` — serves a stored file

## Requirements

- Python 3.9+

## Run locally (port 5010)

```bash
# 1. Create and activate a virtual environment
python -m venv .venv

# macOS / Linux
source .venv/bin/activate
# Windows (PowerShell)
.venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the server
python main.py
```

Then open http://localhost:5010 in your browser.

Alternatively, run it directly with uvicorn:

```bash
uvicorn main:app --host 0.0.0.0 --port 5010 --reload
```

## Notes

- Uploaded files are stored in the `uploads/` directory (created automatically).
- Filenames are reduced to their basename before saving, so path-traversal
  names like `../../etc/passwd` cannot escape the uploads directory.
- Uploading a file with a name that already exists overwrites the previous one.
