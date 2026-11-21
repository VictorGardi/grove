# Research: glossary and ADRs (voice input)

Source: read-only sub-agent report, saved by the interviewer. Facts only.

## ADRs
- docs/adr/ holds 0001-0005. None covers voice, audio, network, models, paste or preferences. No conflict with any of them.
- Code cites ADR 0023 (packages/protocol/paste.ts:4) and ADR 0055 (packages/ui/design-notes.md:74). Neither exists. The paste rule (a pasted ESC[201~ must not end the paste early) is documented only in code and pinned by packages/protocol/paste.test.ts:10.
- ADR 0004 (docs/adr/0004-usage-from-the-agents-files.md:3,13) is the only precedent for "persist nothing that names user content". Writing audio or transcripts to disk would run against that precedent, not a rule.
- ADR 0005 (:11) mentions a stored preference; no ADR says where preferences live.

## Paste path
- `bracketedPaste` (packages/protocol/paste.ts:8-10) wraps in ESC[200~..ESC[201~ and strips C0/C1 controls except newline and tab, so `\r` never goes through. Never sends Enter.
- Other callers: packages/cli/paste.ts:30-35 (`pasteText`, Enter only when `submit`), packages/ui/diff-panel.ts:819.

## Glossary
- Applies: Tab, Active tab, Exited tab, Tab state, Grove CLI, Core, Holder, Host event, Module (voice is host, not a Module; avoid "module"), Token (indicator colours).
- Missing or ambiguous: "agent tab" vs plain terminal tab; push-to-talk key; listening indicator; dictation / voice input; "input" (the agent's prompt box, which Grove cannot read); "paste"; language setting; speech engine and model; the "didn't catch that" notice; Settings / preference.

## Constraints and tensions
- Offline / no network / no secrets appear only in .scratch/session-search/brief.md:45-47 (scoped to that work), not in any ADR.
- A first-use model download is network use; no decision permits or forbids it.
- README.md:22,141: Grove is run from source; the bundle is local and unsigned, not distributed. A bundled-model size has no documented basis.
- Preferences live in two places: window localStorage (`grove.*`, main.ts:1409) and ~/.grove/config/*.json (five files; settings.json holds only sidebarWidth). Not reconciled in any ADR. persisted-prefs brief lists "any new setting" as a non-goal for that effort only.
- keys.json: a key bound to two actions is invalid (README.md:118); a hold key is a new kind of action (no hold/release action exists).
- No Info.plist, entitlements or mic string exists in packages/ui/src-tauri.
- Shell-tab vs agent-tab distinction: README.md:88 says a shell tab has no agent state; no glossary term names it.
