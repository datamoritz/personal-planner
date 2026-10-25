"""add owner identity, private sessions and single-use login records

Revision ID: 0017_private_sessions
Revises: 0016_uncertainty_notepad
"""
from alembic import op
import sqlalchemy as sa

revision = '0017_private_sessions'
down_revision = '0016_uncertainty_notepad'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('planner_owner',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('google_sub', sa.String(255), nullable=False, unique=True),
        sa.Column('email', sa.String(320), nullable=False))
    op.create_table('planner_sessions',
        sa.Column('token_hash', sa.String(64), primary_key=True),
        sa.Column('google_sub', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('revoked_at', sa.DateTime(), nullable=True))
    op.create_table('planner_login_attempts',
        sa.Column('state_hash', sa.String(64), primary_key=True),
        sa.Column('nonce', sa.String(128), nullable=False),
        sa.Column('pkce_verifier', sa.String(128), nullable=False),
        sa.Column('browser_challenge', sa.String(64), nullable=False),
        sa.Column('frontend_origin', sa.String(255), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False))
    op.create_table('planner_login_grants',
        sa.Column('code_hash', sa.String(64), primary_key=True),
        sa.Column('browser_challenge', sa.String(64), nullable=False),
        sa.Column('google_sub', sa.String(255), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False))


def downgrade():
    for table in ['planner_login_grants', 'planner_login_attempts', 'planner_sessions', 'planner_owner']:
        op.drop_table(table)
