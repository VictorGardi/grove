---
feature: 2026-10-22-copilot-cli-support
phase: plan
status: approved
version: 1
created: 2026-10-22
updated: 2026-10-22
approved_at: 2026-10-22
based_on: [01-outcome.md@1, 02-research.md@1]
forced: []
---

# Plan: GitHub Copilot CLI as a third agent

Two repos: the app (`~/git/grove`, a run worktree) and the skills (`~/git/grove-skills`, the shared grove-* skills and `shared/roles.md`, installed by its `install.sh`). Copilot CLI is not installed here and its public docs say nothing about hooks, session storage or id handling. Every decision below therefore has a stated fallback, and Slice 1 verifies the facts first. A fact that blocks an item turns that item into a documented gap in the run log and the final report, never a silent drop.

**Run rules.** (1) The human's review gate after Slice 1 is where the human chooses the branch of each of D1 to D4 (including which folders D3 and D4 write into) that the verified facts allow; the unattended slices then follow it. (2) If Copilot cannot be installed or signed in for Slice 1, the run halts at that gate with every unverified fact marked as such; nothing after Slice 1 is built on a fact that was not checked, and the human decides whether to proceed. If they do, slices 2, 4, 5 and 6 build only what needs no unverified fact (the code paths and tests that can be exercised without Copilot), and every item that does need one is written to the gap list as "not verified, not shipped as working" with the brief line it belongs to (status and attention, resume, skills, profile roles, file links). (3) The skills repo (`~/git/grove-skills`) gets its own branch `run/<slug>` and one commit per slice that touches it, made by the same child; the human reviews it with the app diff at the slice-1 gate and the final review. (4) Any capability a fact rules out is written to the gap list in `04-run.md` as it is found.

## Decisions

### D1. Where a Copilot session's status comes from
**Context.** Claude status comes from hooks writing a spool file; OpenCode's from a server's event stream. The sidebar needs working, done and waiting, and ideally permission and question attention, from Copilot. This is the one choice that shapes the new agent source and what the human can trust on the card.
**Options.**
- A. Hooks that append to a spool file, like Claude (if Copilot CLI has hooks). Pros: exact signals, same proven pattern, reuses the spool tailer. Cons: depends on hooks existing and on how they are configured per launch.
- B. Read Copilot's own session files on disk. Pros: no hook setup. Cons: undocumented format that may change between releases; latency.
- C. No agent events: status comes only from the terminal pane (foreground process alive or gone, recent output). Pros: always works. Cons: no permission or question attention, working/done is coarse.
**Pick:** A, with the order of fallback B then C decided by the facts from Slice 1 and confirmed at the gate. The source reports only what it can truthfully signal; unsignalled states stay absent. If the human does not choose at the gate, the order A, then B, then C applies. Hooks or settings are supplied per launch and never edit the human's own `~/.copilot/settings.json`; if Copilot offers no per-launch way, A is out. File auto-link needs write paths: under A or B they come from `wrote` events or the source's `lastWrites`; under C there are none, and file auto-link is a documented gap.
**Outcome impact.** The card shows working and done at least, and permission and question attention only if Copilot can signal them; the gaps are listed in the docs.

### D2. How a Copilot session gets its id
**Context.** Grove stores one agent session id per session and uses it to resume. Claude takes an id Grove chooses (`--session-id`); OpenCode takes an id in its own format. Copilot may accept neither.
**Options.**
- A. Grove picks the id and passes it in at launch (only if Copilot has such a flag).
- B. Grove discovers the id Copilot assigned after launch (from its session store or a hook payload) and saves it on the session.
- C. No id: resume means "continue the latest session in this folder".
**Pick:** A if the verified flags allow it, else B, else C (documented as a degraded resume that can pick the wrong conversation when two sessions share a folder).
The model is passed the way the verified Copilot CLI takes it (a flag on its command line, expected from the documented `--model`) and stored unchanged in `launchModel`, as for Claude. The id is persisted in the existing `agentSessionId` field, so no new field and no state-store migration is needed.
**Outcome impact.** Resume brings back the same conversation in A and B; in C it may bring back the latest one in the folder, and the docs say so.

### D3. Where Copilot finds the `grove` skill and the workflow skills
**Context.** Today the app writes the `grove` skill into the Claude and OpenCode skill folders at start-up, and the skills repo's `install.sh` installs the workflow skills for both. Writing into a new place under the human's home or repos is hard to undo and must be chosen.
**Options.**
- A. A user-level Copilot skills folder, written by the app (`grove`) and by `install.sh` (workflow skills), mirroring the other two agents.
- B. Project-level `.github/skills/` in each repo, written when a Copilot session starts. Pros: works if Copilot reads only project folders. Cons: leaves files in every repo, shows in `git status` unless excluded.
- C. Neither: pass the skill text in the launch prompt. Pros: no files. Cons: large prompt every start; workflow skills do not scale.
**Pick:** A if Slice 1 finds a user-level skills location; otherwise B with the files excluded through the repo's `info/exclude`, the way `shared/roles.md` handles the generated OpenCode agent files.
**Outcome impact.** The human gets the `grove` and workflow skills inside Copilot without per-repo clutter where Copilot allows it.

### D4. How a subagent role gets its model in Copilot
**Context.** The auto flow runs `cto`, `researcher` and `reviewer` as subagents, and `implementer` in the child. Claude takes a model per call; OpenCode takes it from a generated agent file. Copilot's custom agents live in `.github/agents/`, but whether they carry a model and can be called as subagents is unverified.
**Options.**
- A. Generate `.github/agents/grove-<role>.md` per resolved role at run start, git-excluded, like the OpenCode recipe.
- B. Copilot sessions run every subagent role on the session's own model.
**Pick:** A, falling back to B for any role Slice 1 or Slice 6 cannot make work, recorded per role in `04-run.md`.
**Outcome impact.** Copilot as `implementer` or any role works; per-role model choice works where Copilot allows it and otherwise inherits, which the run log states.

## Slices

### Slice 1. Verify Copilot, then `grove new copilot` opens a session
**Outcome.** The Copilot facts are written down and confirmed by the human at the gate, and `grove new copilot` from a terminal starts a live Copilot pane that shows as a card in the sidebar, never sandboxed, with a plain message when `copilot` is missing or not signed in.
**Thin end-to-end:** CLI -> app server -> core -> tmux pane -> sidebar card, using a launch-only Copilot source that emits no events and a card with no status. Deliberately missing: dialog and palette entry, status, resume, model, prompt, skills, docs.
**Files.** App: `docs/work/2026-10-22-copilot-cli-support/02-research.md` (a "Verified on a real install" section: install method, version, flags, id handling, resume versus continue, hooks or status signals, skill and agent locations, model option, how sign-in state can be detected), `src/shared/types.ts` (add the kind), `src/core/agents/types.ts`, `src/core/sessions.ts` (label), the renderer `Record` types only as far as the compiler requires, `src/cli/args.ts` and `src/main/cliServer.ts` (accept `copilot`), `src/core/copilot/` (launch argv and the missing or signed-out check), `src/main/index.ts` (register), `src/core/core.ts` (`sandboxKind`, the one refusal point: a Copilot session is never sandboxed, whatever the request says), `src/renderer/src/sandboxOptIn.ts` (a stored opt-in is ignored for Copilot) and `src/core/sandbox/spec.ts`, `auth.ts`, `launch.ts`, `src/shared/sandboxErrors.ts` (their if/else must return the existing refusal for Copilot instead of taking the OpenCode branch), tests beside each. Installing Copilot CLI for the check uses its documented install method; record the version.
**Verification.** `npm test && npm run typecheck`, including tests that a Copilot session is never wrapped when the sandbox is requested by flag, by the persisted opt-in, or by default, and that each sandbox helper refuses Copilot rather than taking the OpenCode branch, and a test for the missing and signed-out messages; `02-research.md` lists each fact above confirmed by running the binary, or marked unverified; manual: in the running app `grove new copilot` opens a Copilot pane and a card appears; with `copilot` off PATH the command fails with a plain message and no dead pane; signed out (or the verified sign-in check) gives its own plain message, or is listed as a gap if Copilot offers no way to tell.

### Slice 2. Model, prompt and resume
**Outcome.** `grove new copilot --model <m> "do X"` starts on that model with that prompt, and a session whose pane is gone resumes into the same conversation (or the D2 fallback).
**Files.** `src/core/copilot/` (argv for start and resume per D2), `src/cli/args.ts` and `src/main/cliServer.ts` (`--model` allowed for Copilot), `src/shared/types.ts` comment, `resources/skills/grove/SKILL.md` usage line, tests (argv, args, cliServer, sessionCreate).
**Verification.** `npm test && npm run typecheck`; manual: start with `--model` and a prompt and see both applied; kill the pane, resume from the app, and the conversation continues; `--model` on a terminal session is still refused.

### Slice 3. Copilot in the dialog, palette and sidebar
**Outcome.** "Copilot" appears third, with an icon and a working shortcut, in the new-session dialog and launch palette; the default kind is unchanged; sandbox controls are absent or disabled for Copilot.
**Files.** Copilot is third in display order and Terminal moves to fourth (a display-order change for Terminal only); Copilot's launch key is Digit4 and Claude, OpenCode and Terminal keep Digit1, Digit2 and Digit3. `src/renderer/src/components/NewSessionDialog.tsx`, `LaunchPalette.tsx`, `ui/Icon.tsx` (name plus svg), `Sidebar.tsx`, `usualKind.ts`, `sandboxOptIn.ts`, their tests.
**Verification.** `npm test && npm run typecheck`; manual: open the dialog and palette, pick Copilot with the mouse and with its shortcut, check the Terminal shortcut still opens Terminal, check the sandbox option for Copilot is unavailable with a short reason, and Claude and OpenCode launch exactly as before.

### Slice 4. Status, attention and file links from Copilot
**Outcome.** A Copilot card shows working while a prompt runs and done or waiting after; permission and question attention and file auto-link appear if Copilot can signal them (D1); where D1 lands on C, file auto-link is listed as a gap.
**Files.** `src/core/copilot/` (source with events, hook settings or file reader per D1, normaliser), `src/core/core.ts` and `src/main/index.ts` wiring, `src/core/testing/fakeAgentSource.ts` if needed, fixtures and normaliser tests.
**Verification.** `npm test && npm run typecheck`, with a normaliser fixture test for every signal the source claims (working, done, each attention kind, each write path); manual: send a prompt, watch the card go working then done; triggering a permission request is a human check at the final review (attention if D1 allows, else it is in the gap list); edit a file in a feature folder and see the session link to it, or confirm the gap.

### Slice 5. The `grove` skill and workflow skills inside Copilot
**Outcome.** A Copilot session can load the `grove` skill and the workflow skills, and uses them to list, start, message, read and wait on other sessions, end to end once.
**Files.** App: `src/main/index.ts` (`installSkill` for Copilot per D3), `resources/skills/grove/SKILL.md` (wording and `wait` list). Skills repo: `install.sh` and `uninstall.sh` (Copilot target per D3), `shared/roles.md` ("In Copilot" paragraph: its question tool, its subagent tool), the skills that name Claude tools (found by grep in this slice and listed in `04-run.md`), `scripts/validate.sh` checks.
**Verification.** App `npm test && npm run typecheck`; skills `bash scripts/validate.sh`, and a check that `uninstall.sh` removes what `install.sh` wrote for Copilot and that any generated file is listed in the repo's `info/exclude`; manual: from a Copilot session run the `grove` skill to start another session, send it a message, wait for it, and read its screen.

### Slice 6. Copilot as a profile role and `grove-run` child
**Outcome.** `grove.config.json` profiles accept `agent: copilot`; a profile with Copilot as `implementer` completes a slice with `grove-run`, and role models apply per D4 or the recorded fallback.
**Files.** Skills repo: `shared/roles.md` (accept `copilot`, subagent recipe per D4, `grove new copilot --model`), `skills/grove-auto/SKILL.md`, `skills/grove-run/SKILL.md` and `references/slice-mode.md`, `shared/config.schema.json`, `scripts/validate.sh`, README. App: nothing beyond Slice 2 unless a gap shows.
**Verification.** `bash scripts/validate.sh`, including a config example with `agent: copilot` that the schema accepts and one with an unknown agent that it rejects, and a check that generated Copilot agent files are git-excluded and removed on a profile switch; manual on a toy repo: each of `cto`, `researcher` and `reviewer` is run once as a Copilot subagent and the result recorded in `04-run.md` as working, model-inheriting or a gap; a small feature runs through the workflow skills in Copilot, and `grove-run --profile` with Copilot as implementer makes two slices, two commits, and `04-run.md` records agent and model per role; a Claude-only profile still runs as before.

### Slice 7. Docs and the gap report
**Outcome.** README, the `grove` skill text and the glossary mention Copilot beside the other agents, and one gap report states what works, what is degraded and what is missing, with a reason for each, including the missing sandbox.
**Files.** App: `README.md`, `CONTEXT.md`, an ADR for the Copilot source and the D1 to D4 outcomes, `docs/work/2026-10-22-copilot-cli-support/04-run.md` gap section. Skills repo: `README.md`.
**Verification.** `npm test && npm run typecheck && npm run build`; the new tests exist for Copilot's start, resume, status and `--model` handling (test files named in the gap report); the default kind is unchanged and Claude and OpenCode start, resume and show status as before (their existing tests pass untouched); the ADR exists and states the picks for D1 to D4 as confirmed at the gate; read the gap report against the brief's "How I'll know it works" and confirm every line is either shown working or listed as a gap with a reason.

## Reviewer round log

- Round 1 (5 blocking, 8 non-blocking). Blocking: slice 1 too large and stubs unnamed → fixed by naming the launch-only source and keeping model, prompt, resume and UI in later slices; sandbox only checked by UI → fixed by an explicit refusal and test in Slice 1; no rule for Copilot not installable or signed in → fixed by Run rules; signed-out message unowned → fixed in Slice 1; file link lost under D1 C → fixed in D1 as a documented gap. Applied non-blocking: gate confirms the branch, D3 precedent reworded, model passing noted, shortcut named, risks added, Slice 7 checks tests and regression.
- Round 2 (3 blocking, 7 non-blocking). Blocking: run built on unverified facts → fixed by Run rules limiting slices 2, 4, 5, 6 to what needs no unverified fact; no check that subagent roles run in Copilot → fixed in Slice 6 verification; sandbox refusal point vague → fixed by naming `sandboxKind`, the persisted opt-in and the sandbox helpers with tests. Applied non-blocking: gate also chooses D3 and D4, palette order stated, fixture tests per signal, ADR check, skills repo branch and commits, wait and screen risks.
- Round 3 (2 blocking, 9 non-blocking). Blocking: Terminal display order unstated → fixed in Slice 3 and Deviations, with a Terminal shortcut check; id storage unstated → fixed in D2 (existing `agentSessionId`). Applied non-blocking: D1 default order and per-launch settings, uninstall and exclude checks, schema accept and reject test, permission trigger as a final-review human check.
- CTO check (0 blocking).

## Deviations from the brief the human should know

One: Terminal moves from third to fourth in the display order so that Copilot is third as the brief says; its shortcut is unchanged. Otherwise none beyond the brief's own latitude. The plan keeps every line of the brief; D1 to D4 each name a fallback so a line that Copilot cannot support becomes a documented gap, as the brief says.

## Risks and what is deliberately not done

- Copilot CLI facts are unverified until Slice 1; any of D1 to D4 may land on its fallback, shrinking status detail, resume accuracy or per-role models.
- Installing Copilot CLI for Slice 1 needs a signed-in GitHub account with Copilot access; without one the live checks cannot run and the run halts there rather than guessing.
- Copilot's token is stored in plain text under `~/.copilot/`: Grove never reads, logs or copies it.
- Writing skills or agent files into the human's home or repos is hard to undo: `uninstall.sh` and the exclude entries are tested in Slices 5 and 6.
- Copilot's flags and behaviour may change between releases: the verified version is recorded in `02-research.md` and the gap report.
- The not-installed banner that exists for OpenCode is OpenCode-only: Copilot gets its own launch-time message in Slice 1.
- `grove wait` and `waitTurn` rely on status, so under a coarse D1 (C) the `grove` skill's wait may be unreliable; this is listed in the gap report if it happens.
- Reading a Copilot screen or spool could expose a token if Copilot prints one; Grove does not store screens or spool data beyond what exists for the other agents.
- Out on purpose (the brief's non-goals): sandbox support for Copilot, changing the default kind or Claude and OpenCode behaviour, transcript reading, managing Copilot login or billing, any other agent.

## Open questions
