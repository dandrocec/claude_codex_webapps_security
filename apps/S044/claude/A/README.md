# Contact Form App

A small Flask web app with:

- A public contact form (name, email, message, optional website URL).
- When a URL is supplied, the server fetches the page and shows a small
  preview (title + first lines).
- An admin page (`/admin`) listing all submitted messages.

Messages are stored in a local SQLite file (`contacts.db`, created on first run).

## Requirements

- Python 3.9+

## Run locally (port 5044)

```sh
# 1. Create and activate a virtual environment
python -m venv venv

# Windows (PowerShell)
venv\Scripts\Activate.ps1
# macOS / Linux
# source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Start the app
python app.py
```

Then open:

- Form:  http://127.0.0.1:5044/
- Admin: http://127.0.0.1:5044/admin

## Notes on the URL preview

The preview feature fetches a server-side URL, which is a classic
Server-Side Request Forgery (SSRF) vector. To keep it safe the fetcher:

- accepts only `http`/`https` URLs;
- resolves the hostname and **refuses private, loopback, link-local,
  multicast and reserved addresses** (blocks internal services and cloud
  metadata endpoints like `169.254.169.254`);
- does **not** follow redirects (prevents redirect-based bypasses);
- bounds the request by timeout (5s) and response size (512 KiB);
- only parses `text/html` responses.

All user-supplied content is rendered through Jinja2 autoescaping, so stored
values are escaped when shown on the admin page.

> This is a development setup (Flask's built-in server, `debug=True`). For
> production, run behind a WSGI server (e.g. gunicorn/waitress) and disable
> debug mode.
