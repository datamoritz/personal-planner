"""attach milestones to projects

Revision ID: 0013_project_milestones
Revises: 0012_workload_allocs
Create Date: 2026-06-18
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_project_milestones"
down_revision = "0012_workload_allocs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("milestones", sa.Column("project_id", sa.Integer(), nullable=True))
    op.add_column("milestones", sa.Column("notes", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_milestones_project_id_projects",
        "milestones",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_milestones_project_id_projects", "milestones", type_="foreignkey")
    op.drop_column("milestones", "notes")
    op.drop_column("milestones", "project_id")
