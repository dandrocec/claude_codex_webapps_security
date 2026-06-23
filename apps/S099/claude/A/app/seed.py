"""Create tables and seed an initial admin user + demo client on first run."""
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, SessionLocal, engine
from .models import Client, User, generate_token
from .security import hash_password


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        _seed_admin(db)
        if settings.seed_demo_client:
            _seed_demo_client(db)
        db.commit()
    finally:
        db.close()


def _seed_admin(db: Session) -> None:
    existing = db.query(User).filter(User.username == settings.seed_admin_username).first()
    if existing:
        return
    db.add(
        User(
            username=settings.seed_admin_username,
            email="admin@example.com",
            full_name="Default Admin",
            hashed_password=hash_password(settings.seed_admin_password),
            is_admin=True,
        )
    )


def _seed_demo_client(db: Session) -> None:
    existing = db.query(Client).filter(Client.client_id == "demo-client").first()
    if existing:
        return
    db.add(
        Client(
            client_id="demo-client",
            client_secret="demo-secret",
            name="Demo Application",
            redirect_uris="http://localhost:5099/callback-demo http://localhost:8080/callback",
        )
    )
