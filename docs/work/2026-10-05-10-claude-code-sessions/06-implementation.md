---
feature: 2026-10-05-10-claude-code-sessions
phase: implementation
status: draft
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at:
based_on:
  - 05-plan.md@1
forced: []
---

# Implementation: Claude Code sessions

## Progress

- [ ] Slice 1 — Tracer: start a Claude session, spool fills; state v2 (code committed; live hook capture pending)
- [ ] Slice 2 — Seam generalised (D1), OpenCode unchanged
- [ ] Slice 3 — Claude live status
- [ ] Slice 4 — Claude auto-link and restart catch-up
- [ ] Slice 5 — Claude resume and cleanup

## Slice 1

Deviations (mechanical, no design impact):

- Core creates the spool dir (`mkdirSync`, mode 0700) in `sessionCreate` for now; the design puts this in `SpoolClaude`, which arrives in slice 3.
- `CoreOptions.claudeSpoolDir?: string` stands in for the Claude source until slice 3; without it `sessionCreate({kind:'claude'})` returns `no-source` (the design's error for a missing source).
- `withStatus` and the OpenCode id lookups in `linkWrite`, `catchUp`, `wrote` and `resync` also require `kind === 'opencode'`, so a Claude card never takes OpenCode status before slice 2 makes these per kind.
- `readVersioned` stamps `schemaVersion: n + 1` itself after `migrations[n]`, so a migration only reshapes the data.
- `setupCore().make(now, over)` takes option overrides; `createClaude` helper added to `src/core/testing/setup.ts`.
- `IconName` now includes `claude` (Lucide asterisk); `SessionsBoard` and `Sidebar` pass `s.kind` as the icon name; `.iconOpencode` renamed `.iconAgent`.

Verification: `npm test -- src/core/store src/core/claude src/core/sessions.test.ts` (57 passed), `npm run typecheck` clean, `npm test` (298 passed, run outside the sandbox). A throwaway check confirmed the `--settings` JSON survives `loginShellArgv` quoting with a userData path containing a space.

Hook capture (manual, pending): per hook, fired or not, fields used by the mapping, sizes, corrupt spans.

## Open questions
