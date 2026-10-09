# 0033. Sessions persist a sandboxed flag and the state file goes to v8

Date: 2026-10-09

## Status

Proposed

## Context

A session can be launched sandboxed (`docs/work/2026-10-08-agent-sandboxing`).
`sessionResume` re-launches a gone agent session from its stored fields, so a
session that was confined and is resumed without the flag would come back
unconfined — silently widening what that session can touch, on a machine whose
whole point in running it is that it can't do that again.

ADR 0029 added `Session.cwd` for the same reason and used the same mechanism:
a persisted per-session field plus one step in the state migration chain.

## Decision

- **Field:** `Session.sandboxed: boolean`, persisted, set once at creation and
  read again by `sessionResume`.
- **Migration:** the state file goes to v8; `v7ToV8` sets `sandboxed: false` on
  every saved session, so every session that exists today keeps launching exactly
  as it does now.
- **Opt-in:** `sessionCreate` takes `sandboxed?: boolean`. Absent means `false`;
  there is no project-level default and no session kind for it.

## Consequences

- A resumed sandboxed session stays sandboxed; the human cannot widen a session
  by resuming it.
- A v8 state file can't be read by older builds; as with ADR 0029 it is moved
  aside rather than misread.
- Rejected: a `sandbox: { enabled, image, network }` object (schema surface for
  fields nothing reads yet — `image` and `network` are not per-session choices);
  not persisting it (resume silently unconfines); making sandboxing the default
  (the feature is explicitly opt-in per the questions phase).