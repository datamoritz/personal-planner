#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="/tmp/planner-dev-copy"

PORT=3000

echo "Checking for existing dev server on port ${PORT}..."
PIDS="$(lsof -ti tcp:${PORT} || true)"
if [[ -n "${PIDS}" ]]; then
  echo "Stopping existing process(es): ${PIDS}"
  kill ${PIDS} || true
  sleep 1
fi

echo "Preparing clean workspace copy at ${RUN_DIR}..."
rm -rf "${RUN_DIR}"
mkdir -p "${RUN_DIR}"
rsync -a --delete \
  --exclude .git \
  --exclude .next \
  --exclude node_modules \
  "${ROOT_DIR}/" "${RUN_DIR}/"

if [[ ! -e "${RUN_DIR}/node_modules" ]]; then
  ln -s "${ROOT_DIR}/node_modules" "${RUN_DIR}/node_modules"
fi

cd "${RUN_DIR}"

echo "Removing copied .next cache..."
rm -rf .next

echo "Starting fresh frontend on http://localhost:${PORT}"
exec env NEXT_DISABLE_WEBPACK_CACHE=1 npx next dev --webpack
