"""add life mandala state

Revision ID: 0015_mandala_state
Revises: 0014_email_automation_runs
Create Date: 2026-08-01
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_mandala_state"
down_revision = "0014_email_automation_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mandala_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("document_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("mandala_state")
