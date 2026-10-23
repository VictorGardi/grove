# 0033. Sessions persist a sandboxed flag and the state file goes to v8

Date: 2026-10-09

## Status

Superseded by [0045](./0045-sandboxing-is-left-to-each-provider.md)

## Context

A session can be launched sandboxed (`docs/work/2026-10-08-agent-sandboxing`).
`sessionResume` re-launches a gone agent session from its stored fields, so a
session that was confined and is resumed without the flag would come back
unconfined — silently widening what that session can touch, on a machine whose
whole point in running it is that it can't do that again.

ADR 0029 added `Session.cwd` for the same reason and used the same mechanism:
a persisted per-session field plus one step in the state migration chain.

## Decision

Superseded. Grove removed sandboxed sessions and leaves isolation to each agent provider; [ADR 0045](./0045-sandboxing-is-left-to-each-provider.md) records it. The decision below is kept for history.

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

## Addendum: what resume does when the sandbox cannot be built

Date: 2026-10-11

The flag was persisted and then read by nothing: `sessionResume` rebuilt its argv
from the agent source alone, so a confined session came back on the host. The
flag's reason for existing is only realised once the resume path reads it.

Resume now goes through the same argv builder as creation, so a sandboxed
session resumes inside its container, with the same mount set, and re-probes for
a credential (a resume can happen after the human logged out).

**Where the sandbox cannot be built — a pruned image, no `container` binary, no
reachable credential — the resume downgrades rather than refusing.** The session
comes back on the host, `sandboxed` goes false, and the renderer reports it once
in a banner. Two reasons, in order:

- A convenience failure must not lock the human out of their own session. The
  session is otherwise recoverable and still resumable; a refusal over a missing
  image is not.
- The flag's job is to never claim containment the pane does not have. Clearing
  it and saying so preserves that; a silent downgrade would destroy it.

So the consequence above holds whenever the sandbox is available, and the
exception is loud. Creation still refuses `no-sandbox`: there, nothing is being
recovered and a refusal costs nothing.