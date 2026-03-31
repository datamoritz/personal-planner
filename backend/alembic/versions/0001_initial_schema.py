"""Initial schema — all planner tables + client_id UUID columns.

Production-safe: uses IF NOT EXISTS checks so it is safe to run against a DB
that already has google_oauth_tokens (from prior manual setup).

Revision ID: 0001
Revises:
Create Date: 2026-03-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _existing_tables(conn) -> set[str]:
    return set(inspect(conn).get_table_names())


def upgrade() -> None:
    conn = op.get_bind()
    existing = _existing_tables(conn)

    # ------------------------------------------------------------------
    # google_oauth_tokens — may already exist in production, skip if so
    # ------------------------------------------------------------------
    if "google_oauth_tokens" not in existing:
        op.create_table(
            "google_oauth_tokens",
            sa.Column("provider", sa.String(50), primary_key=True),
            sa.Column("refresh_token", sa.Text, nullable=False),
            sa.Column("access_token", sa.Text, nullable=False),
            sa.Column("updated_at", sa.DateTime, nullable=False),
        )

    # ------------------------------------------------------------------
    # projects
    # ------------------------------------------------------------------
    if "projects" not in existing:
        op.create_table(
            "projects",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("client_id", sa.Uuid, nullable=True),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("color", sa.String(50), nullable=True),
            sa.Column("is_finished", sa.Boolean, nullable=False, server_default="false"),
            sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        )

    # ------------------------------------------------------------------
    # tags
    # ------------------------------------------------------------------
    if "tags" not in existing:
        op.create_table(
            "tags",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("client_id", sa.Uuid, nullable=True),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("color", sa.String(50), nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
            sa.UniqueConstraint("name", name="uq_tags_name"),
        )

    # ------------------------------------------------------------------
    # recurrent_tasks
    # ------------------------------------------------------------------
    if "recurrent_tasks" not in existing:
        op.create_table(
            "recurrent_tasks",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("client_id", sa.Uuid, nullable=True),
            sa.Column("project_id", sa.Integer, sa.ForeignKey("projects.id"), nullable=True),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("location", sa.String(50), nullable=False, server_default="backlog"),
            sa.Column("notes", sa.Text, nullable=True),
            sa.Column("recurrence_rule", sa.String(255), nullable=False),
            sa.Column("default_start_time", sa.Time, nullable=True),
            sa.Column("default_end_time", sa.Time, nullable=True),
            sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        )

    # ------------------------------------------------------------------
    # tasks
    # ------------------------------------------------------------------
    if "tasks" not in existing:
        op.create_table(
            "tasks",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("client_id", sa.Uuid, nullable=True),
            sa.Column("project_id", sa.Integer, sa.ForeignKey("projects.id"), nullable=True),
            sa.Column(
                "recurrent_task_id",
                sa.Integer,
                sa.ForeignKey("recurrent_tasks.id"),
                nullable=True,
            ),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("notes", sa.Text, nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("location", sa.String(50), nullable=False, server_default="backlog"),
            sa.Column("task_date", sa.Date, nullable=True),
            sa.Column("start_time", sa.Time, nullable=True),
            sa.Column("end_time", sa.Time, nullable=True),
            sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
            sa.Column("completed_at", sa.DateTime, nullable=True),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        )

    # ------------------------------------------------------------------
    # task_tags  (junction)
    # ------------------------------------------------------------------
    if "task_tags" not in existing:
        op.create_table(
            "task_tags",
            sa.Column("task_id", sa.Integer, sa.ForeignKey("tasks.id"), primary_key=True),
            sa.Column("tag_id", sa.Integer, sa.ForeignKey("tags.id"), primary_key=True),
        )

    # ------------------------------------------------------------------
    # recurrent_task_tags  (junction)
    # ------------------------------------------------------------------
    if "recurrent_task_tags" not in existing:
        op.create_table(
            "recurrent_task_tags",
            sa.Column(
                "recurrent_task_id",
                sa.Integer,
                sa.ForeignKey("recurrent_tasks.id"),
                primary_key=True,
            ),
            sa.Column("tag_id", sa.Integer, sa.ForeignKey("tags.id"), primary_key=True),
        )

    # ------------------------------------------------------------------
    # calendar_entries
    # ------------------------------------------------------------------
    if "calendar_entries" not in existing:
        op.create_table(
            "calendar_entries",
            sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
            sa.Column("client_id", sa.Uuid, nullable=True),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("notes", sa.Text, nullable=True),
            sa.Column("entry_date", sa.Date, nullable=False),
            sa.Column("start_time", sa.Time, nullable=False),
            sa.Column("end_time", sa.Time, nullable=False),
            sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
            sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        )


def downgrade() -> None:
    # Drop in reverse dependency order.
    # google_oauth_tokens is intentionally omitted — we never drop it in case
    # it pre-existed this migration.
    op.drop_table("calendar_entries")
    op.drop_table("recurrent_task_tags")
    op.drop_table("task_tags")
    op.drop_table("tasks")
    op.drop_table("recurrent_tasks")
    op.drop_table("tags")
    op.drop_table("projects")
