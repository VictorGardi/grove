# 0015. Live session status with a persisted "seen" mark

Date: 2026-10-05

## Status

Accepted

## Context

OpenCode sessions show working / waiting / idle / gone (ADR 0005). The human
defined waiting as "my move": a pending permission or question, **or** a
finished turn not yet seen; a finished turn becomes idle once the session is
on screen with the window focused. That "seen" state must survive app
restarts. The OpenCode service keeps pending items in memory only and drops
them silently on stop, so any persisted status is stale on load. tmux liveness
and OpenCode status are independent: a turn keeps running after its TUI dies.

## Decision

`Session.lastStatus` stays tmux liveness (`running | gone`) and becomes
reversible (Resume sets `running`). The OpenCode status (`status`,
`waitingFor`) is live-only on the `Session`, stripped on save like `branch`,
and recomputed from the service on start and every reconnect. One persisted
field, `seenAt`, records when the human last saw the session; a finished turn
is waiting while OpenCode's `time.idle` is later than `seenAt`.

## Consequences

- Only one small persisted field; no `schemaVersion` bump (missing → `null`).
- Waiting extends ADR 0005's "pending permission or form" with unseen finished
  turns; OpenCode's own `session.viewed` is not used (spike S2: never emitted).
- Until the first re-sync after start, OpenCode cards show tmux liveness only.
- Rejected: persisting a five-value `lastStatus` (stale on load, a write per
  transition, every reader widened); a separate unpersisted status slice
  (loses "seen" across restarts, renderer joins two slices).
