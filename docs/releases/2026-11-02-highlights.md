# Highlights production release — November 2, 2026

Live app: https://planner.moritzknodler.com

- Application commit: `745f1cd` (release branch `codex/planner-highlights`).
- Frontend deployment: `dpl_2iJMS1RbkaTKGGigENUQQtFSZjox`, https://personal-planner-lhkxrhspy-moritzs-projects-972ecff0.vercel.app.
- Previous frontend: `dpl_E68vnJqT7oAh6pJanFWQdBoi4srw`, https://personal-planner-2bbp8nwr4-moritzs-projects-972ecff0.vercel.app.
- Previous backend commit: `7a4dc3c7a42ba3539653b7a46a346c8738a185c7`.
- Database migration: `0018_highlights`; adds only `planner_highlights` and `highlight_conversions`.
- Dummy samples and preview sign-in remain confined to the loopback test fixture. No sample data was imported into production.

Validation: 16 client tests, 33 backend tests, TypeScript, ESLint, Chromium/WebKit interaction and layout checks, and Vercel production build passed. Backend health and migration were verified; the live public pages return 200 and unauthenticated Highlights API calls return 401. No production tasks or calendar events were created for testing.

## Rollback

Restore the previous frontend from the linked Vercel project:

```sh
npx vercel promote https://personal-planner-2bbp8nwr4-moritzs-projects-972ecff0.vercel.app --yes
```

A verified custom-format PostgreSQL backup, original backend image ID and commit, and rollback Compose override are retained on the server in:

`/opt/planner-api/backups/before-highlights-7a4dc3c-20261102/`

The previous backend image is retained as `planner-backend:before-highlights-7a4dc3c`. To restore it while preserving all data, run on the server:

```sh
cd /opt/planner-api/backend
docker compose -f docker-compose.yml -f /opt/planner-api/backups/before-highlights-7a4dc3c-20261102/rollback-compose.yml up -d --no-deps --no-build planner-backend
curl -fsS http://127.0.0.1:8001/health
```

The override starts the previous application without invoking its older Alembic migration runner. Leave the two new tables and migration revision in place during an application rollback: they do not affect the previous app and retain any highlights created after release. Restoring the full database backup or downgrading the schema is unnecessary for this rollback and would discard subsequent data.
