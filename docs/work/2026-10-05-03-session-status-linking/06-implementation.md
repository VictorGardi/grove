---
feature: 2026-10-05-03-session-status-linking
phase: implementation
status: draft
version: 2
created: 2026-10-06
updated: 2026-10-06
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
  - 05-plan.md@2
forced: []
---

# Implementation: session status, linking and resume

## Progress

- [x] Slice 1 — Tracer: live working / idle
- [x] Slice 2 — Waiting on a permission or question
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

## Slice 2 — Waiting on a permission or question

Verification: the slice's test commands pass (57 + 26 tests); `npm test` 218
passed, 3 skipped, 5 failed (only the real-tmux tests, sandbox `posix_spawnp`
as in slice 1); `npm run typecheck` and `npm run build` clean. Manual check
changed: the planned permission trigger (write outside the project) asked no
permission, since the human's OpenCode allows such writes by default. Run instead
with the `question` tool: the session card and header showed waiting, confirmed by
the human on 2026-10-06. Not checked by hand: the "waiting · permission" label
(covered by `normalise` and `status` tests) and clicking the header button to focus
the session.

Deviations (small, two-way):

- A subagent's own `exec-started`/`exec-ended` do not change its root's
  working/idle (only its pending items count, per the Subagents row); the
  slice 1 test that folded a child's turn into the root was replaced.
- Every OpenCode form counts as a question, whatever its `metadata.kind`.
- "Longest-waiting" uses the time the renderer first saw each session waiting
  (`waitingSince` in the renderer store, reset on reload; unknown times sort
  last). No new `Session` field.
- `src/core/features.test.ts` "links a session to a feature by hand": a linked
  terminal now leaves the card `backlog`, not `running` (Card roll-up row).
- New store action `showSession(id)` (list view + focus) for the header chip.

## Open questions
