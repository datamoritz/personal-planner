"""Add ON DELETE SET NULL to task and recurrent_task FK columns.

Without this, deleting a project or recurrent task that still has child rows
causes a FK constraint violation. This migration drops and recreates those
constraints with ON DELETE SET NULL so parent deletion gracefully nullifies
the FK on child rows rather than erroring.

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-30
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # tasks.project_id → ON DELETE SET NULL
    op.execute("""
        ALTER TABLE tasks
            DROP CONSTRAINT IF EXISTS tasks_project_id_fkey,
            ADD CONSTRAINT tasks_project_id_fkey
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    """)

    # tasks.recurrent_task_id → ON DELETE SET NULL
    op.execute("""
        ALTER TABLE tasks
            DROP CONSTRAINT IF EXISTS tasks_recurrent_task_id_fkey,
            ADD CONSTRAINT tasks_recurrent_task_id_fkey
                FOREIGN KEY (recurrent_task_id) REFERENCES recurrent_tasks(id) ON DELETE SET NULL
    """)

    # recurrent_tasks.project_id → ON DELETE SET NULL
    op.execute("""
        ALTER TABLE recurrent_tasks
            DROP CONSTRAINT IF EXISTS recurrent_tasks_project_id_fkey,
            ADD CONSTRAINT recurrent_tasks_project_id_fkey
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    """)


def downgrade() -> None:
    # Revert to plain FK (no cascade rule)
    op.execute("""
        ALTER TABLE tasks
            DROP CONSTRAINT IF EXISTS tasks_project_id_fkey,
            ADD CONSTRAINT tasks_project_id_fkey
                FOREIGN KEY (project_id) REFERENCES projects(id)
    """)
    op.execute("""
        ALTER TABLE tasks
            DROP CONSTRAINT IF EXISTS tasks_recurrent_task_id_fkey,
            ADD CONSTRAINT tasks_recurrent_task_id_fkey
                FOREIGN KEY (recurrent_task_id) REFERENCES recurrent_tasks(id)
    """)
    op.execute("""
        ALTER TABLE recurrent_tasks
            DROP CONSTRAINT IF EXISTS recurrent_tasks_project_id_fkey,
            ADD CONSTRAINT recurrent_tasks_project_id_fkey
                FOREIGN KEY (project_id) REFERENCES projects(id)
    """)
