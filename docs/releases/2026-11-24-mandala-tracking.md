# Mandala goal tracking production release — November 24, 2026

Live app: https://planner.moritzknodler.com

- Application commit: `cd1a09bdb3188349e7f4127a957e3667cddce5d1` (branch `codex/mandala-tracking-local`).
- Frontend deployment: `dpl_Egb25FyooHFf4YQDKbREzXshztq8`, https://personal-planner-rd6tzenno-moritzs-projects-972ecff0.vercel.app.
- Previous live frontend: `dpl_Cf2eiFiqMi8gAL5GMKJCuG4EAE8K`, https://personal-planner-wep0qhhje-moritzs-projects-972ecff0.vercel.app.
- Previous main source: `a3bd15c`; previous backend: `a7b25e936bf96dfac8d337e9354587cd4c13795d`.
- Migration: `0020_mandala_tracking`; adds tracking preferences/configuration/activity tables and task/recurring-task assignment and provenance columns. Existing rows default to unlinked, untracked, and not automatically generated.
- Tags: `planner-before-mandala-tracking-20261124` (previous main) and `planner-mandala-tracking-20261124` (deployed application).

Includes optional frequency/review targets, manual activity logging, linked-task assignment through a compact header picker, task completion/undo accounting, goal-driven reminders, pause/snooze, status icons, and the reviewed compact popup refinements. Existing daily notes retain dash lists, nesting and keyboard behavior; the empty-note placeholder is removed. Tracking settings autosave and the popup's top-right check flushes pending changes before closing. Calendar spacing, tile colors/sizes, and existing task detail fields are retained.

## Validation and data preservation

66 backend tests, 16 client tests, scoped ESLint, TypeScript, Chromium/WebKit tracking and mobile-task checks, the existing Chromium/WebKit notes regression suite, and the Vercel production build passed. UI checks include edits during an in-flight settings save and failed-save/retry behavior.

Before the live migration, the verified database dump was restored to a temporary PostgreSQL database on the same server. Migration 0020 preserved the existing task contents, notes and Mandala document. Eight concurrent evaluations using four separate sessions created exactly one reminder; repeated completion and undo produced exactly one activity and then zero. The temporary database was removed afterward.

The live backend was healthy at migration 0020 before promoting the frontend. Immediately afterward, task/note counts and the Mandala document hash matched their pre-switch values: 416 tasks, zero daily-note rows, 44 Mandala nodes. Tracking targets, activity rows and generated tasks were initially zero. No dummy fixtures or sample data were imported into production.

The live domain was verified Ready; About/Privacy returned 200, unauthenticated app access redirected to login, and tracking/notes/tasks/highlights API calls returned 401. New routes use the existing private gateway. Existing tiles require explicit opt-in; automatic reminders default off.

## Rollback

Restore the previous frontend:

```sh
npx vercel promote https://personal-planner-wep0qhhje-moritzs-projects-972ecff0.vercel.app --yes
```

The verified custom-format PostgreSQL backup, previous backend commit/image IDs, pre-switch data counts/hash, and rollback Compose override are retained in:

`/opt/planner-api/backups/before-mandala-tracking-a7b25e9-20261124/`

Backup: `planner_db.dump`, SHA-256 `0449e63c36864c347369b9f8d3a92c30ab6c9e87b280e09b4fc12765f17395b1`. The archive listing and restoration to the temporary PostgreSQL database were verified.

Previous image: `planner-backend:before-mandala-tracking-a7b25e9`, image ID `sha256:e02571528055556d19f51a574d313937ec90455efa869e812d006ca21b31c230`. The new image is also retained as `planner-backend:mandala-tracking-cd1a09b`.

To restore the previous backend on the server:

```sh
cd /opt/planner-api/backend
docker compose -f docker-compose.yml -f /opt/planner-api/backups/before-mandala-tracking-a7b25e9-20261124/rollback-compose.yml up -d --no-deps --no-build planner-backend
curl -fsS http://127.0.0.1:8001/health
```

Restore both frontend and backend for a full application rollback. The override starts the retained application without its older Alembic runner. Leave the new columns, tables and migration revision in place to retain subsequent activity history and task changes. Generated tasks remain ordinary tasks in the previous application. A full database restore or schema downgrade is unnecessary for application rollback and risks discarding data written after release.
