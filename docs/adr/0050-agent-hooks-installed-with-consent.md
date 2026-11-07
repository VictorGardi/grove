# 0050. Agent hooks are installed into the user's settings only with consent

Date: 2026-11-05

## Status

Accepted

Reverses the design decision that Grove never edits the user's own agent settings (Claude's per-launch settings and Copilot's per-launch plugin keep `~/.claude/settings.json` and `~/.copilot/settings.json` untouched; see `docs/work/2026-11-04-grove-v2-spaces-tabs/02-research.md`), and the post-run step "install by hand, once" in `04-run.md`.

Amended by [0053](0053-agent-status-from-osc-7501.md): status now comes from OSC 7501, so the consent flow installs only a Claude SessionStart hook (its session id), and Copilot and OpenCode have no entry.

## Context

Claude and Copilot report their state through hooks. A tab Grove launches gets them per launch, so Grove needs no edit to the user's settings. An agent the human types into a plain terminal gets no hooks, so it can show only what presence can see, and Copilot's permission and question waits never show. Writing the hooks into the user's global settings is the only way to report those, and it was done by hand with `grove-next integration install`. That step is easy to miss, and nothing told the human that status was partial. A file that a tool reads at every session start is a global change, so it should not happen silently, and it should not happen on the app's own initiative.

## Decision

- **Asked once, by the app.** When an agent Grove did not start (Claude or Copilot) is running and its settings have no Grove entry and no answer is recorded, the app asks once: "Enable status for <agent>?". The question names what is written and where, the backup path, and how to remove it. Buttons are Enable and Not now.
- **Not now is recorded and never asked again by itself.** Closing the prompt another way counts as Not now. The Agents entry stays available.
- **Nothing global is written without a yes.** Only the `integration.install` request writes, and the app sends it only from the Enable or Update button. The CLI (`grove-next integration install|uninstall`) remains the by-hand path and writes the same entries.
- **The Agents entry** (sidebar footer, "Agent status") lists Claude and Copilot with Enabled, Not enabled, Out of date or Settings unreadable, the resolved settings and backup paths, and Enable, Update or Remove. Remove deletes only Grove's entries.
- **Out of date is not a re-ask.** A later release that adds hook events does not ask again. The entry shows Out of date with an Update button.
- **Unreadable files are never touched.** A settings file that is not a JSON object is reported with its error, and no button changes it.
- **OpenCode needs no entry** and is not offered.

## Consequences

- The per-launch design stays for runs that Grove starts. The user's settings change only after a yes, and the backup written beside the file is the way back.
- A Copilot or Claude session that was already running when the entry was installed does not load the hooks until it starts again. The entry and the prompt say so where it matters.
- The answer record lives in the Grove home (`integrations.json`). Deleting it asks again on the next detection.
- Tests write only into temporary `CLAUDE_CONFIG_DIR` and `COPILOT_HOME` folders.
