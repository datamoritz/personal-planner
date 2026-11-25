"""Optional Mandala targets, activity history and existing-task assignments."""
from alembic import op
import sqlalchemy as sa
revision = '0020_mandala_tracking'
down_revision = '0019_mandala_notes'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('recurrent_tasks', sa.Column('mandala_node_id', sa.String(100), nullable=True))
    for column in [sa.Column('mandala_assignment_override', sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column('mandala_node_id', sa.String(100), nullable=True),
                   sa.Column('generated_by_mandala', sa.Boolean(), nullable=False, server_default=sa.false()),
                   sa.Column('mandala_touched', sa.Boolean(), nullable=False, server_default=sa.false()),
                   sa.Column('mandala_period_start', sa.Date(), nullable=True),
                   sa.Column('recurrent_cycle_date', sa.Date(), nullable=True)]:
        op.add_column('tasks', column)
    op.create_table('mandala_preferences', sa.Column('id', sa.Integer(), primary_key=True), sa.Column('timezone', sa.String(100), nullable=False))
    op.create_table('mandala_tracking', sa.Column('node_id', sa.String(100), primary_key=True),
                    sa.Column('settings_json', sa.Text(), nullable=False), sa.Column('revision', sa.Integer(), nullable=False))
    op.create_table('mandala_activities', sa.Column('id', sa.String(100), primary_key=True),
                    sa.Column('node_id', sa.String(100), nullable=False), sa.Column('activity_type', sa.String(20), nullable=False),
                    sa.Column('activity_date', sa.Date(), nullable=False), sa.Column('occurred_at', sa.DateTime(), nullable=False),
                    sa.Column('created_at', sa.DateTime(), nullable=False),
                    sa.Column('task_id', sa.Integer(), sa.ForeignKey('tasks.id', ondelete='SET NULL'), nullable=True),
                    sa.Column('source_key', sa.String(150), unique=True, nullable=True), sa.Column('notes', sa.Text(), nullable=False))
    op.create_index('ix_mandala_activities_node_id', 'mandala_activities', ['node_id'])


def downgrade():
    op.drop_table('mandala_activities')
    op.drop_table('mandala_tracking')
    op.drop_table('mandala_preferences')
    for name in ['recurrent_cycle_date', 'mandala_period_start', 'mandala_touched', 'generated_by_mandala', 'mandala_assignment_override', 'mandala_node_id']:
        op.drop_column('tasks', name)
    op.drop_column('recurrent_tasks', 'mandala_node_id')
