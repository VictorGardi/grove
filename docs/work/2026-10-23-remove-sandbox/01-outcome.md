---
feature: 2026-10-23-remove-sandbox
phase: outcome
status: approved
version: 1
created: 2026-10-23
updated: 2026-10-23
approved_at: 2026-10-23
based_on: []
forced: []
---

# Outcome: remove the sandbox feature

## Summary

Grove no longer offers sandboxed sessions. Isolation is each provider's job (Claude Code, GitHub Copilot, OpenCode). All sandbox code, UI, CLI and socket options, error codes, tests and live docs are removed. Sessions that were started in a sandbox are dropped from the list on upgrade. Leftover containers, the built image and the edit Grove made to the user's OpenCode `service.json` are cleaned up once on first launch (the setting is restored only if it still holds the value Grove wrote). The history is kept and marked superseded by one new ADR.

## What the human sees and does

- No sandbox toggle, ⌥S shortcut, "Isolation" row or sandbox mark in the launch palette, the new-session dialog, the session header or the session cards.
- `grove new ... --sandboxed` and the socket `sandboxed` option give the normal unknown-option error, with no special message.
- README has no "Sandboxed sessions" bullet, no `--sandboxed` example and no Apple container prerequisite. CONTEXT.md no longer defines Sandboxed session, Sandbox spec or Container bridge. Where useful, the docs say once that isolation is left to each provider.
- After upgrading, sessions that were sandboxed are gone from the list. The first launch quietly stops and removes old containers and the image, and restores the OpenCode setting. Every session started afterwards runs on the host.
- A new ADR (0045) records that the sandbox was removed in favour of each provider's own isolation. ADRs 0033-0036, 0039 and 0040 are marked Superseded by it (0038 already is). Backlog tasks T-191 and T-196 are closed or archived as obsolete. The old feature folder and the research notes and reports stay as history.

## Non-goals

- Building any replacement isolation in Grove.
- Keeping or migrating old sandboxed sessions.
- A deprecation message or helpful error for the old flag.
- Touching unrelated "sandbox" uses: the artifact viewer iframe sandbox and CSP (ADRs 0007, 0021, 0022, 0026), Claude Code's own `sandbox` setting.
- Rewriting the ~25 work folders that only mention the word in passing.
- Deleting any ADR, feature folder, research note or report.

## How I'll know it works

- No sandbox-related code, strings, error codes or CSS remain, apart from the unrelated iframe and CSP uses.
- Tests and typecheck pass; the build works.
- `grove new --sandboxed` fails with the standard unknown-option error.
- A state file that contains sandboxed sessions loads with those sessions absent.
- On first launch with old containers, the image and the edited `service.json` present, they are cleaned up, and a second launch does nothing.
- README, CONTEXT.md and ADR statuses are consistent with the above.

## Interview log

**Q1. What should happen to sessions that were started in a sandbox before this update?** Options: A ordinary silently; B ordinary plus one-time note (recommended); C read-only; D drop from the list on upgrade.
**A1.** D: drop them from the list on upgrade. (The human chose this over the recommendation, knowing it loses those sessions' history from the list.)

**Q2. What should happen to the leftovers on people's machines (old containers, built image, the opencode service.json change)?** Options: A clean up all once on first launch, restoring the opencode setting only when it is still the value Grove wrote (recommended); B containers and image only, document opencode; C document only; D nothing.
**A2.** A: clean up all, once, on first launch after upgrade.

**Q3. What should someone see when starting a session with the old `--sandboxed` flag or socket option?** Options: A clear refusal naming the provider (recommended); B start ordinary with a warning; C flag simply gone, normal unknown-option error; D silently ignored.
**A3.** C: the flag is simply gone; the CLI gives its normal unknown-option error, and the socket option gets the same treatment.

**Q4. What should happen to the written history about the sandbox?** Options: A keep, add one new ADR and mark the old ones superseded (recommended); B keep, no new ADR; C delete it all; D as A, plus delete sandbox-only research and mockups.
**A4.** A: keep, one new ADR (0045), old ADRs marked superseded, tasks T-191/T-196 closed or archived, research stays.

## Open questions
