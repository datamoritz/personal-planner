# Mandala daily notes

The Mandala canvas uses its full window width. Single-click still selects tiles; double-click (or Enter on a focused tile) opens one floating notes window. The window initially sits beside its tile, follows the tile while anchored, and stays where the user places it after dragging its header or resizing its corner. It is tinted with the current branch color. Spacing controls remain available as a toolbar popover.

The notes window shows complete text in editable, automatically expanding fields. Only the window body scrolls. Enter moves to the next line; a second Enter creates a half-height blank line. Shift+Enter keeps a soft line break. Typing `- ` starts a hanging dash list. Enter continues it, Enter on an empty item exits it, and Tab/Shift+Tab nest or unnest list items. Both the top-level and nested indent are 12px. List levels and continuations are persisted as plain text with tab-indented dash prefixes. Pasted text remains plain, and native undo/redo is retained. Each tile has one note per local calendar day, newest first, with subtle date headings. Today has an empty writing area until a note is written; opening a tile does not create empty server records. The date changes automatically when an open window crosses midnight. Earlier daily notes can be amended. The date heading’s tooltip includes the last saved edit time.

The close X becomes a check mark after local note additions/deletions or tile-field edits in that window, and stays a check after autosave. Reopening without edits starts with X again; incoming sync updates do not mark it as edited. The pencil reveals the existing title, placement, branch-color, and child-tile controls. The center and loose tiles also support notes. Deletion first shows Yes/No confirmation naming the child-tile count and warning that all branch notes will be deleted. Confirming removes the entire branch; unrelated notes remain intact.

## Storage and deployment

Published November 24, 2026. Deployment identifiers, validation, backup, and rollback commands are recorded in [the release record](releases/2026-11-24-mandala-notes.md).

Apply Alembic migration `0019_mandala_notes` before deploying this frontend. It adds the `mandala_notes` table, keyed by tile ID and day. Notes are stored separately from the Mandala structure, so renaming/reparenting and older structure saves cannot overwrite them. Deleting nodes removes their note rows in the same transaction. Note writes lock the structure row to prevent orphan notes during concurrent branch deletion.

The existing owner-only gateway protects `/mandala/notes` and `/mandala/notes/day`. Note updates use compare-and-swap revisions, including first writes. Lost-response retries are idempotent. The client reuses the tested notepad merge logic to reconcile devices, preserving both versions when changes overlap. Writes are serialized per daily note; typing during a save remains pending. Browser storage keeps pending text across reloads. Autosave runs after 650 ms, on closing/switching windows, on reconnect, and retries failed saves after 20 seconds. Open windows also refresh their tile’s notes every 20 seconds while visible.

The Mandala structure retains its existing API and layout model. Structure saves are now serialized so slower earlier requests cannot overwrite newer edits. No task/event detail views or calendar spacing were changed.

## Validation

Run backend unit tests from `backend/` with its requirements and httpx installed. Run the existing `tests/notepad-sync.test.cjs` merge/sync tests, TypeScript, ESLint, and the production frontend build.

`tests/mandala-browser.test.mjs` runs Chromium and WebKit against the disposable loopback fixture from `tests/highlights-preview.py`. It verifies the fixture marker before resetting its Mandala data. Configure `PLANNER_MANDALA_TEST_ORIGIN`, `PLANNER_MANDALA_TEST_SESSION`, and optionally `PLANNER_PLAYWRIGHT_MODULE`. Use a separate `PLANNER_HIGHLIGHTS_PREVIEW_DB` for this test; never point it at the production backend or a demo whose edits should be retained.
