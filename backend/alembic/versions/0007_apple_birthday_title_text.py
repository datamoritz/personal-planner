"""Allow long Apple birthday titles.

Some CardDAV contacts have extremely long display names or organizational
labels. The cached birthday title should not fail sync because of that.

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("apple_birthday_contacts", "title", existing_type=sa.String(length=255), type_=sa.Text())


def downgrade() -> None:
    op.alter_column("apple_birthday_contacts", "title", existing_type=sa.Text(), type_=sa.String(length=255))
