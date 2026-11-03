"""Independent planning highlights with optimistic concurrency."""
from alembic import op
import sqlalchemy as sa
revision = '0018_highlights'
down_revision = '0017_private_sessions'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('planner_highlights', sa.Column('id', sa.Integer(), primary_key=True), sa.Column('document', sa.Text(), nullable=False), sa.Column('revision', sa.Integer(), nullable=False))
    op.create_table('highlight_conversions', sa.Column('id', sa.String(64), primary_key=True), sa.Column('result', sa.Text(), nullable=False))

def downgrade():
    op.drop_table('highlight_conversions')
    op.drop_table('planner_highlights')
