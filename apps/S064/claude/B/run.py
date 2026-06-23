"""Development entry point.

Run with:  python run.py
Serves on http://127.0.0.1:5064
"""
import os

from dotenv import load_dotenv

load_dotenv()  # load variables from a local .env file if present

from app import create_app

app = create_app()

if __name__ == "__main__":
    # debug is driven by FLASK_DEBUG; defaults to off so stack traces are never
    # exposed unless a developer explicitly opts in.
    debug = os.environ.get("FLASK_DEBUG", "0").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host="127.0.0.1", port=5064, debug=debug)
