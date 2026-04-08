"""Add recurrent task cycle state fields

Revision ID: 0010_recurrent_task_cycle_state
Revises: 0009_planner_goals_milestones
Create Date: 2026-04-08
"""

from alembic import op
import sqlalchemy as sa


revision = "0010_recurrent_task_cycle_state"
down_revision = "0009_planner_goals_milestones"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("recurrent_tasks", sa.Column("anchor_date", sa.Date(), nullable=True))
    op.add_column("recurrent_tasks", sa.Column("completed_through_date", sa.Date(), nullable=True))
    op.execute("UPDATE recurrent_tasks SET anchor_date = DATE(created_at) WHERE anchor_date IS NULL")


def downgrade() -> None:
    op.drop_column("recurrent_tasks", "completed_through_date")
    op.drop_column("recurrent_tasks", "anchor_date")
