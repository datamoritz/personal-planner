"""Add tag_id FK column to tasks table.

The frontend model supports one tag per task. Rather than using the existing
task_tags junction table (which would require join queries), we add a direct
nullable tag_id FK on tasks. ON DELETE SET NULL ensures tag deletion
automatically clears the association.

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-31
"""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE tasks
            ADD COLUMN IF NOT EXISTS tag_id INTEGER
                REFERENCES tags(id) ON DELETE SET NULL
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE tasks DROP COLUMN IF EXISTS tag_id")
