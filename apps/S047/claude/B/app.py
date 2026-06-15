"""WSGI / dev entry point for the inventory tracker."""
import os

from inventory import create_app

app = create_app()

if __name__ == "__main__":
    # Bind to localhost only by default; debug is OFF so stack traces never reach clients.
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5047"))
    app.run(host=host, port=port, debug=False)
