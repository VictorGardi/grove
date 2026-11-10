---
feature: 2026-11-08-agent-appearance-preferences
phase: implementation
status: draft
version: 1
created: 2026-11-08
updated: 2026-11-08
approved_at:
based_on:
  - docs/adr/0054-agent-appearance-preferences.md
forced:
  - "Human explicitly requested proceeding despite missing approved structure and plan (2026-11-08); no artifact is self-approved."
---

# Implementation: agent appearance preferences

The Appearance settings tab holds the existing theme picker and the new agent
appearance controls. State-color overrides and the working-indicator choice
persist in window storage; unset colors inherit the active theme. Working
indicators use three dots by default or three waveform bars, with either shape
static under reduced motion.

Verification:

- `cd next && npm test`: 702 tests passed.
- Targeted appearance integration and indicator tests passed after the Appearance
  tab move and keyboard-focus update.
- `cd next && npm run typecheck` passed.
