# 0044. GitHub Copilot CLI is a third agent source, with hooks per launch

Date: 2026-10-22

## Status

Accepted

## Context

Grove ran Claude Code and OpenCode. Copilot CLI (`copilot`) was added as a third agent
kind. Its public docs say little about hooks, session ids or custom agents, so Slice 1
ran the real binary (1.0.102, then 1.0.103) and recorded each fact as verified or
unverified in `docs/work/2026-10-22-copilot-cli-support/02-research.md`. The hard-to-undo
choices are where status comes from, how a session gets its id, where skills are written
and how a subagent role gets its model. The plan is `03-plan.md` in that folder.

## Decision

- **Status (D1 = A).** Hooks append to a per-session spool file
  (`<userData>/agents/copilot/<id>.jsonl`), tailed like the Claude spool. The hooks are
  supplied per launch through `--plugin-dir` (a generated `plugin.json` and
  `hooks.json`); the human's `~/.copilot/settings.json` is never edited. Hook payloads do
  not name their event, so the hook command stamps it. Signalled: working, done,
  permission attention, file writes (for file links).
- **Id (D2 = A).** Grove mints a UUID and passes `--session-id`; resume is
  `--resume=<id>`. The id lives in the existing `agentSessionId`. `--model` is stored in
  `launchModel` and passed on start and resume; the prompt goes in as `--interactive=<prompt>`
  (start only).
- **Skills (D3 = A).** User-level `~/.copilot/skills` (honours `COPILOT_HOME`): the app's
  "Install Agent Skill…" menu item links the bundled `grove` skill there beside the
  Claude and OpenCode folders; the skills repo's `install.sh --target copilot-only`
  installs the workflow skills (skills repo branch `run/2026-10-22-copilot-cli-support`,
  pending merge, as is the D4 recipe in its `shared/roles.md`). Nothing is written into a repo.
- **Role models (D4 = A, settled by the Slice 6 probe on 1.0.103).** For a Copilot subagent role the run generates
  `.github/agents/grove-<role>.md` with a `model:` line, git-excluded through the repo's
  `info/exclude` and removed on a profile switch; subagents are called with the `task`
  tool. Verified for `reviewer`, `cto`, `researcher` and `implementer`.
- **No sandbox.** Copilot is never wrapped in the container sandbox; every sandbox helper
  refuses the kind and the dialog says why. A source may also expose an optional
  `preflight()` so a missing `copilot` is refused before any pane exists.
- The default session kind, and Claude and OpenCode behaviour, are unchanged.

## Consequences

- Copilot shows working, done and permission attention, and links files it writes. No
  question attention, subagent marks or context gauge: Copilot gave no verified signal.
- Unverified: every check ran in `-p` runs, not in an interactive tmux pane (resume after a
  dead pane, hooks and permission attention in a pane); file-write paths are seen only
  for `apply_patch` and `bash`, `edit` and `create` are handled but unseen; the D4
  git-exclude and delete-on-profile-switch steps are specified and grep-checked, not run;
  agent files written mid-session may not be picked up by a running pane; no `grove-run`
  with Copilot as implementer was run end to end.
- Signed-out Copilot is not detected (the token sits in the keychain, with no read-only
  check); Copilot shows its own login message. Grove only checks that `copilot` is on the
  login shell's PATH.
- Rejected: reading `~/.copilot/session-state/<id>/events.jsonl` (D1 B, an undocumented
  format that could change, and not needed); no agent events (D1 C, coarse status and no
  attention); discovering the id after launch (D2 B) or `--continue` (D2 C, can resume
  the wrong conversation); project-level `.github/skills` (D3 B, clutters every repo);
  all roles on the session's model (D4 B, kept only as the per-role fallback).
- Copilot's flags and hooks may change between releases; the verified versions are
  recorded in the research file and the gap report in `04-run.md`.
