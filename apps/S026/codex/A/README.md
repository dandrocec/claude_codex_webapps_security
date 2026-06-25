# Flask Blog

A small blog application built with Python, Flask, and SQLite. Users can register, log in, and manage their own posts. The home page lists all posts newest first, and each post has a detail page.

## Run locally

Create a virtual environment and install dependencies:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Initialize the SQLite database:

```bash
flask --app app init-db
```

Start the app on port 5026:

```bash
flask --app app run --host 127.0.0.1 --port 5026
```

Open http://127.0.0.1:5026 in your browser.
