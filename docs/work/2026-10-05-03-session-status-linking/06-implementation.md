---
feature: 2026-10-05-03-session-status-linking
phase: implementation
status: draft
version: 1
created: 2026-10-06
updated: 2026-10-06
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
  - 05-plan.md@1
forced: []
---

# Implementation: session status, linking and resume

## Progress

- [x] Slice 1 — Tracer: live working / idle
- [ ] Slice 2 — Waiting on a permission or question
- [ ] Slice 3 — Re-sync, reconnect, fallback banner
- [ ] Slice 4 — Finished turn waits until seen; notifications
- [ ] Slice 5 — Auto-link
- [ ] Slice 6 — Resume

## Slice 1 — Tracer: live working / idle

Started 2026-10-06 after `2026-10-05-04-artifact-viewer` finished on the same
branch (paused on 2026-10-05 to avoid two sessions editing one checkout).

Verification: the slice's test commands pass (34 + 6 tests); `npm test` 205
passed, 3 skipped (the 5 real-tmux tests in `src/core/backend/tmux.test.ts`
fail only inside the Claude Code sandbox with `posix_spawnp`; 8/8 pass outside
it); `npm run typecheck` and `npm run build` clean. Manual check (live service,
working → idle): passed, confirmed by the human on 2026-10-06.

Deviations (small, two-way):

- `src/core/opencode/client.test.ts` created now (structure: slice 3) to cover
  the pure SSE splitter `sseData` and `serviceFilePath`.
- `FeaturePage.tsx` linked-session rows use `statusView` too, so they match
  the sidebar card.
- `sessionCreate` returns the session after `refreshStatus()` (so a new
  OpenCode session comes back with `status: 'idle'` while connected).
- `apply` creates a tracker for any OpenCode session on the service, not only
  grove's; `withStatus` reads only grove sessions' trackers. Trackers reset on
  every connect/disconnect.
- Reconnect is a fixed 1 s retry until slice 3 adds backoff; `HttpOpenCode`
  logs nothing.

## Open questions
