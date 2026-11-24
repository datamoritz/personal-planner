# Mandala daily notes production release — November 24, 2026

Live app: https://planner.moritzknodler.com

- Application commit: `a7b25e936bf96dfac8d337e9354587cd4c13795d` (branch `codex/mandala-daily-notes`).
- Frontend deployment: `dpl_5fR24w65BAdoxFcojH2EyRjgpfor`, https://personal-planner-rj3yor0so-moritzs-projects-972ecff0.vercel.app.
- Previous frontend: `dpl_2yT9rtgL45PodNqWDpNQZ6oGNKzb`, https://personal-planner-gqa9x8vsf-moritzs-projects-972ecff0.vercel.app.
- Previous main source: `9a8d30a`; previous backend commit: `745f1cd2a7d6d3325eee205b272fa1b770d9610b`.
- Database migration: `0019_mandala_notes`; adds the separate `mandala_notes` table.
- Release tags: `planner-before-mandala-notes-20261124` (previous main) and `planner-mandala-notes-20261124` (deployed application).

Includes the floating daily notes window, compact header, tile editing and confirmed branch deletion, plain-text dash lists with subtle nesting, corrected Enter spacing, and the close X changing to a check after local edits. Calendar spacing and task/event detail views were not changed.

Validation: 16 client tests, 39 backend tests, TypeScript, ESLint, Chromium/WebKit browser suites, and Vercel production build passed. The promoted domain was verified Ready. Backend health and migration were verified; all 44 existing Mandala nodes remained present, with zero note rows before first use. Public About/Privacy pages returned 200, the app redirected unauthenticated visitors to login, and unauthenticated notes/tasks/highlights API requests returned 401. No sample data was imported into production.

## Rollback

Restore the previous frontend from the linked Vercel project:

```sh
npx vercel promote https://personal-planner-gqa9x8vsf-moritzs-projects-972ecff0.vercel.app --yes
```

The verified custom-format PostgreSQL backup, previous backend commit/image IDs, and rollback Compose override are retained at:

`/opt/planner-api/backups/before-mandala-notes-745f1cd-20261124/`

Database backup: `planner_db.dump`, SHA-256 `ccaaddb033e55e7ef6272d74462c04a28818939d839c3fb203aec0bb87a38515`. Its archive listing was verified with `pg_restore --list`.

The previous image is retained as `planner-backend:before-mandala-notes-745f1cd` (image ID `sha256:b2b405e8cfb2aa782bc4c17937161ebb6db20d77cef0c77ee7bae539479287ab`). To restore it on the server:

```sh
cd /opt/planner-api/backend
docker compose -f docker-compose.yml -f /opt/planner-api/backups/before-mandala-notes-745f1cd-20261124/rollback-compose.yml up -d --no-deps --no-build planner-backend
curl -fsS http://127.0.0.1:8001/health
```

The override starts the previous application without invoking its older Alembic runner. Leave the notes table and migration revision in place: they do not affect the previous app and preserve notes written after release. An ordinary application rollback does not require a database restore or schema downgrade; those would risk discarding subsequent data.
