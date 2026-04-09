"""add milestone type

Revision ID: 0011_milestone_type
Revises: 0010_recurrent_task_cycle_state
Create Date: 2026-04-08
"""

from alembic import op
import sqlalchemy as sa


revision = "0011_milestone_type"
down_revision = "0010_recurrent_task_cycle_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("milestones", sa.Column("type", sa.String(length=20), nullable=True))
    op.execute("UPDATE milestones SET type = 'major' WHERE type IS NULL")
    op.alter_column("milestones", "type", nullable=False)


def downgrade() -> None:
    op.drop_column("milestones", "type")
