"""add shared, date-independent uncertainty notepad

Revision ID: 0016_uncertainty_notepad
Revises: 0015_mandala_state
"""

from alembic import op
import sqlalchemy as sa

revision = "0016_uncertainty_notepad"
down_revision = "0015_mandala_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "uncertainty_notepad",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("uncertainty_notepad")
