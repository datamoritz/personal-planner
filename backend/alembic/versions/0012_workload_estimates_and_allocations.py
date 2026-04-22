"""add workload estimates and allocations

Revision ID: 0012_workload_allocs
Revises: 0011_milestone_type
Create Date: 2026-04-22
"""

from alembic import op
import sqlalchemy as sa
from datetime import datetime


revision = "0012_workload_allocs"
down_revision = "0011_milestone_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("estimate_hours", sa.Float(), nullable=True))

    op.create_table(
        "task_allocations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("allocation_date", sa.Date(), nullable=False),
        sa.Column("hours", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", "allocation_date", name="uq_task_allocations_task_date"),
    )

    op.create_table(
        "weekly_capacity_templates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("capacity_hours", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("weekday", name="uq_weekly_capacity_templates_weekday"),
    )

    weekly_capacity_templates = sa.table(
        "weekly_capacity_templates",
        sa.column("weekday", sa.Integer()),
        sa.column("capacity_hours", sa.Float()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    now = datetime.utcnow()
    op.bulk_insert(
        weekly_capacity_templates,
        [
            {"weekday": 0, "capacity_hours": 6.0, "created_at": now, "updated_at": now},
            {"weekday": 1, "capacity_hours": 2.0, "created_at": now, "updated_at": now},
            {"weekday": 2, "capacity_hours": 6.0, "created_at": now, "updated_at": now},
            {"weekday": 3, "capacity_hours": 2.0, "created_at": now, "updated_at": now},
            {"weekday": 4, "capacity_hours": 4.0, "created_at": now, "updated_at": now},
            {"weekday": 5, "capacity_hours": 0.0, "created_at": now, "updated_at": now},
            {"weekday": 6, "capacity_hours": 0.0, "created_at": now, "updated_at": now},
        ],
    )


def downgrade() -> None:
    op.drop_table("weekly_capacity_templates")
    op.drop_table("task_allocations")
    op.drop_column("tasks", "estimate_hours")
