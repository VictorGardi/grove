---
kind: feature
created: 2026-10-08
flow: standard
---

# Agent session sandboxing

Let a session's agent process (opencode/claude) roam freely within its own
working directory but be structurally unable to touch the rest of the host
filesystem — opt-in per session, for longer sessions doing heavy code
generation, not a default for every session.

## Flow log

- 2026-10-08: standard (size S/M, investigation only — no questions phase run yet)
