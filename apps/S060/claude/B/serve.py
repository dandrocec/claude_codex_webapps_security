"""Production-style entry point using the waitress WSGI server on port 5060.

    python serve.py

Unlike the Flask dev server, waitress is suitable for non-debug use and
never exposes a debugger. Run behind a TLS-terminating reverse proxy in
real deployments (and keep SESSION_COOKIE_SECURE=True there).
"""
from waitress import serve

from app import app

if __name__ == "__main__":
    serve(app, host="127.0.0.1", port=5060)
