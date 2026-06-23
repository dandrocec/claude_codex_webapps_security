from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    # role is either "employer" or "applicant"
    role = db.Column(db.String(20), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    jobs = db.relationship(
        "Job", back_populates="employer", cascade="all, delete-orphan"
    )
    applications = db.relationship(
        "Application", back_populates="applicant", cascade="all, delete-orphan"
    )

    @property
    def is_employer(self):
        return self.role == "employer"

    @property
    def is_applicant(self):
        return self.role == "applicant"


class Job(db.Model):
    __tablename__ = "jobs"

    id = db.Column(db.Integer, primary_key=True)
    employer_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    title = db.Column(db.String(200), nullable=False)
    location = db.Column(db.String(120), nullable=False, default="")
    description = db.Column(db.Text, nullable=False, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    employer = db.relationship("User", back_populates="jobs")
    applications = db.relationship(
        "Application", back_populates="job", cascade="all, delete-orphan"
    )


class Application(db.Model):
    __tablename__ = "applications"

    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey("jobs.id"), nullable=False, index=True)
    applicant_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    cover_letter = db.Column(db.Text, nullable=False, default="")
    # stored (sanitized, unique) filename on disk
    resume_filename = db.Column(db.String(255), nullable=False)
    # original filename as uploaded, for display/download
    resume_original_name = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    job = db.relationship("Job", back_populates="applications")
    applicant = db.relationship("User", back_populates="applications")

    __table_args__ = (
        db.UniqueConstraint("job_id", "applicant_id", name="uq_one_application_per_job"),
    )
