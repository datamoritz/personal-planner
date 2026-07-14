"""track email automation runs

Revision ID: 0014_email_automation_runs
Revises: 0013_project_milestones
Create Date: 2026-07-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_email_automation_runs"
down_revision = "0013_project_milestones"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "email_automation_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("automation_type", sa.String(length=50), nullable=False),
        sa.Column("gmail_message_id", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("source_subject", sa.Text(), nullable=True),
        sa.Column("source_sender", sa.Text(), nullable=True),
        sa.Column("event_id", sa.String(length=255), nullable=True),
        sa.Column("parsed_json", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "automation_type",
            "gmail_message_id",
            name="uq_email_automation_runs_type_message",
        ),
    )


def downgrade() -> None:
    op.drop_table("email_automation_runs")
