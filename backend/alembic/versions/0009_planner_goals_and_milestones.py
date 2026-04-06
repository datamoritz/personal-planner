"""planner goals and milestones

Revision ID: 0009_planner_goals_and_milestones
Revises: 0008_apple_birthday_message_text
Create Date: 2026-04-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "0009_planner_goals_and_milestones"
down_revision = "0008_apple_birthday_message_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "goals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("color", sa.String(length=50), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.add_column("projects", sa.Column("goal_id", sa.Integer(), nullable=True))
    op.add_column("projects", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("projects", sa.Column("end_date", sa.Date(), nullable=True))
    op.create_foreign_key(
        "fk_projects_goal_id_goals",
        "projects",
        "goals",
        ["goal_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "milestones",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("milestones")
    op.drop_constraint("fk_projects_goal_id_goals", "projects", type_="foreignkey")
    op.drop_column("projects", "end_date")
    op.drop_column("projects", "start_date")
    op.drop_column("projects", "goal_id")
    op.drop_table("goals")
