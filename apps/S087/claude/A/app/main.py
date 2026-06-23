from fastapi import FastAPI

from .database import Base, engine
from .routers import auth, projects, users

# Create tables on startup. For a real project use Alembic migrations instead.
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Multi-Tenant SaaS Skeleton",
    description=(
        "A FastAPI skeleton where each organisation (tenant) has its own users and data. "
        "Data is isolated per organisation via an org_id discriminator enforced on every query."
    ),
    version="1.0.0",
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(projects.router)


@app.get("/", tags=["meta"])
def root():
    return {"status": "ok", "docs": "/docs"}


@app.get("/health", tags=["meta"])
def health():
    return {"status": "healthy"}
