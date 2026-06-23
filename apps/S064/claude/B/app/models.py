"""Database models.

SQLAlchemy is used as the data-access layer. All queries it generates are
parameterised, which prevents SQL injection by construction — user input is
never concatenated into SQL strings.
"""
from datetime import datetime, timezone

from flask_login import UserMixin

from app import db, bcrypt

# Allowed task statuses for the board. Enforced in forms and at the model
# helper level so a client can never set an arbitrary status.
TASK_STATUSES = ("todo", "doing", "done")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(UserMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    username = db.Column(db.String(80), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    memberships = db.relationship(
        "Membership", back_populates="user", cascade="all, delete-orphan"
    )

    def set_password(self, password: str) -> None:
        # bcrypt automatically generates a per-password random salt and stores
        # it inside the resulting hash string.
        self.password_hash = bcrypt.generate_password_hash(password).decode("utf-8")

    def check_password(self, password: str) -> bool:
        return bcrypt.check_password_hash(self.password_hash, password)


class Project(db.Model):
    __tablename__ = "projects"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.String(2000), nullable=False, default="")
    owner_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    owner = db.relationship("User", foreign_keys=[owner_id])
    memberships = db.relationship(
        "Membership", back_populates="project", cascade="all, delete-orphan"
    )
    tasks = db.relationship(
        "Task", back_populates="project", cascade="all, delete-orphan"
    )

    def member_user_ids(self) -> set[int]:
        return {m.user_id for m in self.memberships}

    def is_member(self, user_id: int) -> bool:
        return user_id in self.member_user_ids()

    def is_owner(self, user_id: int) -> bool:
        return user_id == self.owner_id


class Membership(db.Model):
    __tablename__ = "memberships"
    __table_args__ = (
        db.UniqueConstraint("project_id", "user_id", name="uq_member_project_user"),
    )

    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey("projects.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    role = db.Column(db.String(20), nullable=False, default="member")  # owner|member
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)

    project = db.relationship("Project", back_populates="memberships")
    user = db.relationship("User", back_populates="memberships")


class Task(db.Model):
    __tablename__ = "tasks"

    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey("projects.id"), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.String(4000), nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="todo")
    assignee_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = db.Column(
        db.DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    project = db.relationship("Project", back_populates="tasks")
    assignee = db.relationship("User", foreign_keys=[assignee_id])
    creator = db.relationship("User", foreign_keys=[created_by])
