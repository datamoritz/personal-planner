"""Add cached Apple birthday contacts table.

Stores a minimal normalized birthday/contact reference cache so birthdays can
be served quickly and individual contacts can be re-fetched later for details
like phone numbers.

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "apple_birthday_contacts",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("source", sa.String(50), nullable=False, server_default="apple_birthdays"),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("month", sa.Integer, nullable=False),
        sa.Column("day", sa.Integer, nullable=False),
        sa.Column("birth_year", sa.Integer, nullable=True),
        sa.Column("contact_href", sa.Text, nullable=False),
        sa.Column("vcard_uid", sa.String(255), nullable=True),
        sa.Column("etag", sa.String(255), nullable=True),
        sa.Column("last_synced_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("contact_href", name="uq_apple_birthday_contacts_contact_href"),
    )


def downgrade() -> None:
    op.drop_table("apple_birthday_contacts")
