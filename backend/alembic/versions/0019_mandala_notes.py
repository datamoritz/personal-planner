"""Dated notes belonging to individual Mandala tiles."""
from alembic import op
import sqlalchemy as sa

revision = '0019_mandala_notes'
down_revision = '0018_highlights'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'mandala_notes',
        sa.Column('node_id', sa.String(100), primary_key=True),
        sa.Column('day', sa.Date(), primary_key=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )


def downgrade():
    op.drop_table('mandala_notes')
