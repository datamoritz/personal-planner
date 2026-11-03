# Highlights

Highlights are private planning backgrounds, separate from tasks, Google events, tags, and workload calculations. Day/Week share an hourly palette (30-minute painting); Month/Year share an independent whole-day palette. Desktop editing is available; mobile displays highlights without intercepting touch gestures.

Select a color beside the date to paint. Drag across cells, select the eraser to remove parts, and press Escape, click outside the paint grid, or click the selected color to stop. Double-click a section's top label to edit it; drag only that header to move it. While painting, double-clicking the background edits its highlight. In normal mode the background passes through existing calendar creation gestures. Existing tasks and events always retain their own interactions.

Double-click a palette color to edit its default label or color, or clear its sections in the current displayed date range or everywhere in that layer. Undo restores completed paint, erase, move, edit, or clear operations. Matching adjacent sections merge. Repainting and partial erasure split sections without overlaps. A changed default label affects future sections; it does not rename old ones.

One label appears per timed section. Month labels appear only at the section's beginning (or first visible cell when clipped by the displayed grid), without repeating at week boundaries. Year cells show labels through hover titles. The all-day area shows that day's Month/Year highlight, separate from timed highlights.

## Storage and synchronization

`planner_highlights` holds a versioned document. The owner-only backend gateway protects all highlight endpoints. Updates use a compare-and-swap revision and reject malformed or overlapping ranges. Client edits are serialized to a persistent local outbox and rebased onto the latest server document. Finishing a stroke/move or saving details queues one operation. Requests retry after errors, on reconnect, on returning to a visible tab, and every 20 seconds while visible. Pending edits survive a reload. Visibility and brush selection are device UI preferences (brushes reset on reload).

Wall-calendar positions use integer half-hour units or whole-day ordinals; they do not shift with the browser's UTC offset or DST changes. Google conversion applies the browser's IANA timezone when creating an event.

Conversion replaces only the selected section after successful creation. Task creation and section removal share a database transaction. Retried conversions use receipts; calendar creation uses a deterministic Google event ID to recover from lost responses. Calendar failures preserve the highlight. Conversion clears brush undo history so undo cannot resurrect a highlight without undoing its created task/event.

Tasks have one scheduled date. A section spanning days becomes one task on its start day, with its original range in notes; the Create task tooltip explains this before creation. A timed section ending on another date becomes an untimed task. Events support the full timed or all-day range.

## Validation and local preview

Production release: November 2, 2026. Migration `0018_highlights` was applied before promoting the frontend. See [the release and rollback record](releases/2026-11-02-highlights.md).

Run:

```sh
node --test tests/highlights.test.cjs tests/notepad-sync.test.cjs
cd backend
python -m unittest discover -s tests -q
```

The browser regression uses a disposable SQLite fixture bound to loopback only. Never run that fixture as a deployed app. It keeps the production access middleware for private endpoints and stubs calendar reads. Start it with a Python environment containing backend requirements and httpx:

```sh
python tests/highlights-preview.py
```

Start Next in a separate terminal:

```sh
PLANNER_GATEWAY_SECRET=highlights-local-only PLANNER_BACKEND_URL=http://127.0.0.1:18108 PLANNER_APP_ORIGIN=http://127.0.0.1:13107 npm run dev -- --hostname 127.0.0.1 --port 13107 --webpack
```

The fixture includes fictional November 2026 birthdays, single-day events, and a multi-day offsite. These calendar samples are read-only and never contact Google. Existing highlight/task edits are retained when the fixture restarts.

To interact with the disposable demo, open `http://127.0.0.1:18108/preview`. That fixture-only route supplies its dummy local session cookie. It is absent from the production app.

The browser test resets fixture tasks/highlights. Run it against a separate fixture database and frontend when preserving interactive demo edits: set `PLANNER_HIGHLIGHTS_PREVIEW_DB`, `PLANNER_HIGHLIGHTS_PREVIEW_WEB_PORT`, and `PLANNER_HIGHLIGHTS_PREVIEW_API_PORT` for the fixture, and point that frontend’s backend URL to the matching API port.

Run the browser test with Playwright available (or set `PLANNER_PLAYWRIGHT_MODULE` to its module path):

```sh
PLANNER_HIGHLIGHTS_TEST_ORIGIN=http://127.0.0.1:13107 PLANNER_HIGHLIGHTS_TEST_SESSION=highlights-local-session node --test tests/highlights-browser.test.mjs
```

The test requires a fixture marker before resetting disposable tasks/highlights. It never operates against a public host or real Google account.
