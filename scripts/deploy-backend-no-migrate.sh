#!/usr/bin/env bash
set -euo pipefail

# Deploy the backend service on the remote server without running migrations.
#
# This script:
# 1. SSHes into the server
# 2. Pulls the latest backend code from main
# 3. Rebuilds only the backend service image
# 4. Restarts only the backend service container
# 5. Prints recent backend logs
#
# Use this when you are sure there are no schema changes to apply.

SSH_TARGET="${SSH_TARGET:-root@5.78.134.84}"
BACKEND_PATH="${BACKEND_PATH:-/opt/planner-api/backend}"
SERVICE_NAME="${SERVICE_NAME:-planner-backend}"
LOG_TAIL_LINES="${LOG_TAIL_LINES:-100}"

echo "Deploying ${SERVICE_NAME} on ${SSH_TARGET}:${BACKEND_PATH} without migrations"

ssh "${SSH_TARGET}" \
  "BACKEND_PATH='${BACKEND_PATH}' SERVICE_NAME='${SERVICE_NAME}' LOG_TAIL_LINES='${LOG_TAIL_LINES}' /bin/bash -seuo pipefail" <<'REMOTE'
cd "${BACKEND_PATH}"

echo "==> Pull latest code"
git pull --ff-only origin main

echo "==> Build backend image"
docker compose build "${SERVICE_NAME}"

echo "==> Restart backend container"
docker compose up -d --no-deps "${SERVICE_NAME}"

echo "==> Recent backend logs"
docker compose logs --tail="${LOG_TAIL_LINES}" "${SERVICE_NAME}"
REMOTE
