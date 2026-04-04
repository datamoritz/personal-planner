"""add apple birthday message text

Revision ID: 0008_apple_birthday_message_text
Revises: 0007_apple_birthday_title_text
Create Date: 2026-04-03 13:25:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0008_apple_birthday_message_text"
down_revision = "0007_apple_birthday_title_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("apple_birthday_contacts", sa.Column("message_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("apple_birthday_contacts", "message_text")
