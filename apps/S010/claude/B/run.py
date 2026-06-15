"""Entry point: launches the app on the configured host/port (default :5010)."""
import uvicorn

from app import config

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT, reload=False)
