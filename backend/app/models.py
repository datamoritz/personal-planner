import uuid
from datetime import datetime, date, time

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, Time, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class GoogleOAuthToken(Base):
    """Stores the single Google OAuth token row (keyed by provider='google')."""
    __tablename__ = "google_oauth_tokens"

    provider: Mapped[str] = mapped_column(String(50), primary_key=True)
    refresh_token: Mapped[str] = mapped_column(Text, nullable=False)
    access_token: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_finished: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    tasks: Mapped[list["Task"]] = relationship(back_populates="project")
    recurrent_tasks: Mapped[list["RecurrentTask"]] = relationship(back_populates="project")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    color: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class RecurrentTask(Base):
    __tablename__ = "recurrent_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, default=uuid.uuid4)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str] = mapped_column(String(50), nullable=False, default="backlog")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    recurrence_rule: Mapped[str] = mapped_column(String(255), nullable=False)
    default_start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    default_end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    project: Mapped["Project | None"] = relationship(back_populates="recurrent_tasks")
    tasks: Mapped[list["Task"]] = relationship(back_populates="recurrent_task")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, default=uuid.uuid4)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    recurrent_task_id: Mapped[int | None] = mapped_column(ForeignKey("recurrent_tasks.id"), nullable=True)
    tag_id: Mapped[int | None] = mapped_column(ForeignKey("tags.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    location: Mapped[str] = mapped_column(String(50), nullable=False, default="backlog")
    task_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    start_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    end_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    project: Mapped["Project | None"] = relationship(back_populates="tasks")
    recurrent_task: Mapped["RecurrentTask | None"] = relationship(back_populates="tasks")


class TaskTag(Base):
    __tablename__ = "task_tags"

    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id"), primary_key=True)


class RecurrentTaskTag(Base):
    __tablename__ = "recurrent_task_tags"

    recurrent_task_id: Mapped[int] = mapped_column(ForeignKey("recurrent_tasks.id"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id"), primary_key=True)


class CalendarEntry(Base):
    __tablename__ = "calendar_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
