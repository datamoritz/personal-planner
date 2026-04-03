"""Add tag_id FK column to recurrent_tasks table.

Allows recurrent tasks to persist a tag so spawned task instances inherit it.

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-03
"""

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE recurrent_tasks
            ADD COLUMN IF NOT EXISTS tag_id INTEGER
                REFERENCES tags(id) ON DELETE SET NULL
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE recurrent_tasks DROP COLUMN IF EXISTS tag_id")
