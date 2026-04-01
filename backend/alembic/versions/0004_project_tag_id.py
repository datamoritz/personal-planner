"""Add tag_id FK column to projects table.

Allows project color tags to persist across refreshes and sync with the frontend.

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-01
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE projects
            ADD COLUMN IF NOT EXISTS tag_id INTEGER
                REFERENCES tags(id) ON DELETE SET NULL
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS tag_id")
