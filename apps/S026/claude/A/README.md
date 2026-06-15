# Flask Blog

A small blog web application built with Python and Flask.

## Features

- User registration and login (passwords are stored hashed).
- Logged-in users can create, edit, and delete **their own** posts (title + body).
- Public home page listing all posts, newest first.
- Each post has its own detail page.
- All data is stored in a local SQLite database (`blog.db`, created automatically on first run).

## Requirements

- Python 3.9 or newer

## Running locally (port 5026)

1. (Optional but recommended) create and activate a virtual environment:

   **Windows (PowerShell):**
   ```powershell
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

   **macOS / Linux:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

2. Install the dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Start the app:

   ```bash
   python app.py
   ```

4. Open your browser at <http://localhost:5026>.

The SQLite database file `blog.db` is created automatically in the project
directory the first time you run the app.

## Notes

- The app uses a default development secret key. For anything beyond local use,
  set a real one via the `SECRET_KEY` environment variable, e.g.:

  ```bash
  # macOS / Linux
  export SECRET_KEY="a-long-random-string"

  # Windows (PowerShell)
  $env:SECRET_KEY = "a-long-random-string"
  ```

## Project structure

```
.
├── app.py              # Application, models, and routes
├── requirements.txt    # Python dependencies
├── README.md
├── static/
│   └── style.css
└── templates/
    ├── base.html
    ├── index.html
    ├── post_detail.html
    ├── post_form.html  # shared by create & edit
    ├── login.html
    └── register.html
```
