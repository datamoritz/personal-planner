# Backend Deploy

## Repo Checks

- Docker Compose is defined in [backend/docker-compose.yml](/Users/moritzknodler/Documents/06_IT%20Projects/Planner/Code/planner/backend/docker-compose.yml).
- The backend service name is `planner-backend`.
- Compose should be run from the backend directory, which matches your server path: `/opt/planner-api/backend`.
- Alembic is available in the backend container:
  - [backend/requirements.txt](/Users/moritzknodler/Documents/06_IT%20Projects/Planner/Code/planner/backend/requirements.txt) includes `alembic`
  - [backend/Dockerfile](/Users/moritzknodler/Documents/06_IT%20Projects/Planner/Code/planner/backend/Dockerfile) copies `alembic.ini` and the `alembic/` folder into the image

## Scripts

- [scripts/deploy-backend.sh](/Users/moritzknodler/Documents/06_IT%20Projects/Planner/Code/planner/scripts/deploy-backend.sh)
  - Use this for normal backend deploys, especially when there may be database schema changes.
- [scripts/deploy-backend-no-migrate.sh](/Users/moritzknodler/Documents/06_IT%20Projects/Planner/Code/planner/scripts/deploy-backend-no-migrate.sh)
  - Use this when you are sure there are no new Alembic migrations to apply.

## What Each Step Does

- `git pull --ff-only origin main`
  - Updates the checked-out backend code safely without creating a merge commit.
- `docker compose build planner-backend`
  - Rebuilds only the backend image.
- `docker compose up -d --no-deps planner-backend`
  - Recreates only the backend container in detached mode and avoids restarting unrelated services.
- `docker compose exec -T planner-backend alembic upgrade head`
  - Runs database migrations inside the backend container without allocating a TTY.
- `docker compose logs --tail=100 planner-backend`
  - Shows recent logs so you can quickly spot startup or migration issues.

## Do You Need `docker compose up -d planner-backend` After `docker compose build planner-backend`?

Yes. `docker compose build planner-backend` only builds the image. It does not restart the running container.

You still need `docker compose up -d --no-deps planner-backend` so the container starts using the newly built image.
