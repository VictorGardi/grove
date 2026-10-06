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
- [x] Slice 3 — Re-sync, reconnect, fallback banner
- [x] Slice 4 — Finished turn waits until seen; notifications
- [x] Slice 5 — Auto-link
- [ ] Slice 6 — Resume

## Approval note

2026-10-06: `03-design.md` and `04-structure.md` had been `status: stale` since
2026-10-05 with unchanged input versions; slices 1–2 were built on them without
a recorded `--force`. The human re-approved `design+structure` (content
unchanged), which marked this file and `05-plan.md` stale; on the human's OK
both were cleared (slices 1–2 done, nothing planned ahead) before slice 3.

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

## Slice 3 — Re-sync, reconnect, fallback banner

Verification: the slice's test commands pass (46 + 35 tests); `npm test` 247
passed, run outside the Claude Code sandbox (inside it, the stub-server tests in
`client.test.ts` fail with `listen EPERM` and the real-tmux tests with
`posix_spawnp`); `npm run typecheck` and `npm run build` clean. Manual check
(service stop → banner, restart → statuses back): passed, confirmed by the
human on 2026-10-06.

Deviations (small, two-way):

- Events that arrive while a snapshot is in flight are queued and re-applied on
  top of it; a snapshot that resolves after a later connect/disconnect is
  dropped; a failed snapshot keeps the event-built trackers.
- Snapshot children: `SessionSnapshot.pending` holds a session's own items;
  the adapter returns an entry for each child too, and the pure
  `fromSnapshot` in `status.ts` folds children's pending items into their root.
- A session OpenCode doesn't know yet (404) gets a blank snapshot with no
  further calls (no children lookup).
- Snapshot ids: OpenCode sessions with `lastStatus 'running'` only.
- `service.json` is polled with `fs.watchFile` (1 s); a change aborts the
  current attempt or wakes the backoff sleep and reconnects without waiting.
- The unreachable timer also runs from `start()`, so a service that is down at
  launch shows the banner after 5 s; the banner needs a live OpenCode session.
- The version banner shows whenever connected to a version other than 2.0.20
  (no live-session condition).
- `SessionBackend.list()` doc comment updated: live = exists and pane not dead.
- The OpenCode `opencode` slice is never written to `state.json`: `set` now
  saves only for `sessions` and `ui`.

## Slice 4 — Finished turn waits until seen; notifications

Verification: the slice's test command passes (54 tests); `npm test` 255
passed (outside the sandbox, as in slice 3); `npm run typecheck` and
`npm run build` clean. Manual check (done → seen → idle across a restart,
one `notification failed` line): passed, confirmed by the human on 2026-10-06.

Deviations (small, two-way):

- `notification failed` is logged once from the main process, so it shows in
  the `npm run dev` terminal, not the DevTools console (structure's wording).
- Notifications only for OpenCode sessions with `lastStatus 'running'`; a gone
  session's status is not shown, so it doesn't alert.
- Transitions are evaluated only while connected and with no snapshot in
  flight; the first re-sync after start (successful or failed) records waiting
  sessions without notifying. A disconnect keeps each session's last waiting
  reason, so a reconnect alerts only on a new reason.
- `seenAt` is set only for OpenCode sessions (terminals never get one beyond
  `null`).
- The slice 1 core test "follows a turn" now expects `waiting · done` after
  an off-screen turn ends (it was `idle` before the seen rule existed).
- Notifications are held in a `Set` until closed, clicked or failed, so a
  click isn't lost to garbage collection; `ready-to-show` also reports the
  initial window focus to core.

## Slice 5 — Auto-link

Verification: the slice's test command passes (46 tests); `npm test` 275
passed (outside the sandbox); `npm run typecheck` and `npm run build` clean.
Manual check pending, for the human.

Deviations (small, two-way):

- The tool name comes from `session.tool.input.started` (the only event
  carrying it) and is held with the `called` input by call id, because `read`
  also has `input.path`; this state lives in `toolWrites()` in `normalise.ts`,
  one per stream.
- A stored tool call counts as completed when its `state` has a `content`
  array and no `error` key (or `status: 'completed'`); research names the
  state variants but not their discriminator. Checked by hand in the manual
  step, not against captured payloads.
- With several paths (a patch), the last one inside a feature folder wins, so
  a `Move to` beats its source. A file directly in the feature root or in a
  dot folder links nothing.
- Catch-up reads the root session's own messages only (newest first, up to 5
  pages of 200), not its subagents'; a session that got a live write since the
  re-sync began is skipped.
- A write to a not-yet-listed folder is held per session until discovery lists
  it; held entries for removed or pinned sessions are dropped.
- `status.apply` ignores `wrote`; core handles it before the snapshot queue.
- `snapshot` and `lastWrites` share a private `get` in `HttpOpenCode`.

## Open questions
