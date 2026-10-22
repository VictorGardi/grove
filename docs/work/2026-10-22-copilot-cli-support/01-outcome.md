---
feature: 2026-10-22-copilot-cli-support
phase: outcome
status: approved
version: 1
created: 2026-10-22
updated: 2026-10-22
approved_at: 2026-10-22
based_on: []
forced: []
---

# Outcome: GitHub Copilot CLI in Grove

## Summary

Grove gains GitHub Copilot CLI as a third agent next to Claude and OpenCode. You can start a Copilot session, watch it in the sidebar, resume it, and have it work with Grove's skills and workflows, as you can with the other two. Copilot sessions run unsandboxed only in this first version.

Not everything Claude and OpenCode do may be possible with Copilot. The interview chose to ship with gaps rather than wait for full parity. Nothing in the research is checked against a real Copilot install yet: `copilot` is not installed here and the research has only GitHub's public flag list. Install method, session id handling, resume versus continue, status signals and hooks, where skills load from, and how a model is passed are all unverified.

The first slice therefore checks these facts against a real install before anything else is built. If a fact blocks an item below, that item becomes a documented gap reported to you. It is never silently dropped, faked or shown as working when it is not.

Defaults for items you were not asked about:
- Copilot is the third agent, after Claude and OpenCode, with the next free launch shortcut (Terminal keeps its current one).
- The default session kind stays what it is today.

## What the human sees and does

- In the new-session dialog and the launch palette, "Copilot" appears after Claude and OpenCode with its own icon and a working shortcut. Picking it opens a Copilot CLI session in a terminal pane in the chosen folder.
- Each Copilot session shows in the sidebar like the others, with its name, kind and status.
- Status shows whatever Copilot can truthfully signal, such as working and done. A state Copilot can't signal is absent or degraded, not invented, and is listed in the docs.
- If the `copilot` command is missing or not signed in, Grove tells you in plain words and does not leave a silent dead pane.
- After a Copilot session ends and its pane is gone, you can resume it from Grove and continue the same conversation. If Copilot can't resume reliably, that is a documented gap.
- `grove new copilot` works from the command line with an optional prompt and `--model`, as for Claude and OpenCode. The new session appears in the sidebar and starts with the prompt.
- Inside a Copilot session the `grove` skill is available: list sessions, start Claude, OpenCode, Copilot or terminal sessions, send a message, read a screen, wait for a session to finish, focus and kill.
- The workflow skills (grove-auto, grove-run, grove-start, grove-design and the rest) work when driven from Copilot.
- Copilot can be named for a role in a profile in `grove.config.json`, for example as implementer. `grove-run --profile <name>` then builds a slice with Copilot.
- Files a Copilot session edits are linked to it, as for the others, if Copilot gives a way to know which files it wrote. If not, the link is a documented gap.
- Sandbox options do not appear for Copilot, or appear disabled with a short explanation. A Copilot session never silently starts inside a sandbox or in the wrong sandbox setup.
- README, the `grove` skill text and the glossary mention Copilot where they mention the other agents, and list every gap, including the missing sandbox.
- At the end you get one report of the gaps: what works, what is degraded, what is missing, and why.

## Non-goals

- Sandbox support for Copilot. Copilot is unsandboxed only in v1, a listed gap for a follow-up.
- Making Copilot the default session kind, or changing Claude or OpenCode behaviour.
- Matching Claude and OpenCode status detail where Copilot offers no signal. Gaps are documented, not worked around with guesses.
- Reading or showing Copilot transcripts. Grove has no transcript reading for any agent today.
- Managing Copilot login, tokens or billing, or changing your Copilot settings.
- Any agent beyond Copilot.

## How I'll know it works

- First slice: a written list of the verified Copilot facts (install method, flags, session id handling, resume versus continue, status signals and hooks, skill location, model option) taken from a real install. Each later item is marked buildable or a documented gap.
- Copilot appears third in the new-session dialog and launch palette with an icon and a working shortcut. A new session opens a live Copilot terminal in the chosen folder.
- Claude and OpenCode still start, resume and show status exactly as before, and the default kind is unchanged.
- A Copilot session shows in the sidebar. While it handles a prompt it shows working, and when it finishes it shows done or waiting. If it asks for permission and Copilot can signal that, the sidebar shows it; otherwise the gap is in the docs.
- Closing a Copilot pane and choosing resume brings back the same conversation, or the gap is documented.
- `grove new copilot --model <m> "do X"` starts a Copilot session using model `<m>` and the prompt `do X`. Without Copilot installed it fails with a clear message.
- From a Copilot session, the `grove` skill lists sessions, starts another session, sends it a message, waits for it to finish and reads its screen, shown end to end once.
- A small feature runs through the grove workflow skills inside Copilot, and a profile with Copilot as implementer completes a slice with `grove-run`.
- Selecting Copilot never starts a sandboxed session. Sandbox controls for Copilot are absent or clearly disabled, and the missing sandbox is listed as a gap.
- The docs list every gap with a reason. No item is unaccounted for.
- Existing tests pass, and new tests cover Copilot's start, resume, status and `--model` handling.

## Interview log

**Q1. If Copilot CLI cannot support every capability that Claude and OpenCode have, what should we do?** Options: Tiered (recommended), Ship with gaps, Hold for full parity.
**A1. Ship with gaps.** Copilot is usable as soon as the core works (sidebar, palette, `grove new copilot` with prompt and --model, sandbox, resume, working/done). Whatever Copilot can't signal is absent or degraded and listed in the docs.

**Q2. Should a Copilot session be able to drive Grove (list, start, message and wait on other sessions) and run the auto workflow, or is Copilot only something you launch and watch for now?** Options: grove skill only (recommended), Launch and watch only, Full parity.
**A2. Full parity.** The `grove` skill and the workflow skills (grove-auto, grove-run, etc.) all work in Copilot, and Copilot can be a profile role such as implementer.

**Q3. In v1, must Copilot sessions work inside the sandbox, and how should you sign in there?** Options: Sandbox with host login (recommended), Sandbox with token env var, Sandbox with either login, No sandbox in v1.
**A3. No sandbox in v1.** Copilot runs unsandboxed only; sandbox support waits for a follow-up and is listed as a gap.

## Open questions
