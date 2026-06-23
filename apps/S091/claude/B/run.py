"""Local entrypoint. Starts the web server (and the in-process worker unless
WORKER_ENABLED=false) on the configured host/port (default 127.0.0.1:5091)."""
import uvicorn

from app.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=False,
        # Do not expose the server banner / detailed errors in logs to clients.
        server_header=False,
    )
