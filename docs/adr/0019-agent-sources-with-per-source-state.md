# 0019. Agent sources run side by side with per-source state

Date: 2026-10-07

## Status

Accepted

## Context

Core took a single optional `OpenCodeSource` and kept its live state (trackers,
subagent roots, connected flag, re-sync generation, event queue, primed flag,
writes since re-sync) in module-level variables. Claude Code (epic v6, child 10,
ADR 0016) adds a second source with different connection semantics: a local
spool is "connected" from the start, while the OpenCode service connects,
drops and reconnects.

## Decision

Core takes `sources: AgentSource[]`, one per agent kind, all implementing one
interface (`kind`, `mintId`, `argv`, `start`, `snapshot`, `lastWrites`,
`forget`, `stop`). Core keeps one `SourceState` per kind and runs re-sync,
status, notifications, auto-link and catch-up per state. Per-kind launch
details (id format, argv, owned files) live in the source, not in core.

## Consequences

- An OpenCode reconnect or outage never resets Claude status, and vice versa.
- Core has no per-kind launch branches; a further agent would be an adapter.
- The refactor touches built status code; the existing OpenCode tests pin it.
- Rejected: a composite source in main behind the single seam (shared
  connected state couples Claude status to the OpenCode service and mixes
  the `opencode` slice); a separate Claude path in core (two mechanisms for
  status, linking and notify).
