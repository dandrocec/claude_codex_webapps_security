"""Development entry point.

Run with:  python run.py     (serves on http://127.0.0.1:5085)

For database setup use:  flask --app run init-db
"""

from portal import create_app

app = create_app()

if __name__ == "__main__":
    # Bind to localhost only; debug is OFF so stack traces are never exposed.
    app.run(host="127.0.0.1", port=5085, debug=False)
