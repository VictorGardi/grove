# 0053. Agent status comes from OSC 7501 only

Date: 2026-11-07

## Status

Accepted

Amends [0050](0050-agent-hooks-installed-with-consent.md): the consent flow stays, but it now installs one Claude hook for the session id, not status hooks, and Copilot is no longer offered one. Slices and decisions: `docs/work/2026-11-07-osc-7501-status/03-plan.md`.

## Context

Claude, Copilot and OpenCode each reported status through a different source: Claude hooks, a Copilot plugin and event log, OpenCode's shared service, plus a watchdog and a screen cross-check to catch what they missed. Each agent now sends its own status report to the terminal as OSC 7501 (`state=working`, `idle`, `blocked`, `done`, `error`, with `:`-separated fields such as `kind=` and `id=`). It was seen on real Claude 2.1.309, Copilot 1.0.107 and OpenCode 2.2.6.

## Decision

- **One source.** The holder parses OSC 7501 on every tab's PTY, answers the `?` query, keeps the last root record per tab, sends `tabs.status` to core and returns the record as `status` on `tabs.list`. Only the root record decides a tab's status.
- **Core maps it.** `working` is working; `blocked` is needs-you with reason `permission`, `question`, `auth` or `error` from `kind`; `error` is needs-you/error; `idle` after working or needs-you is `finished`; `done` is finished. A tab with no report is `unknown`, and a live agent tab names the minimum version in its tooltip.
- **No timers and no screen reads.** Only PTY exit, a core restart with no live holder entry, or an agent that never reports leaves a tab `unknown`. There is no fallback source.
- **Status is not saved.** The sidecar keeps the resume id only. After a core restart, status is read back from the holder's `tabs.list`.
- **The resume id still needs a hook for Claude.** Claude has no `discover()`, so a hand-started tab's id and the id after `/clear` arrive through a SessionStart hook, installed with consent as in 0050. Copilot and OpenCode use `discover()`. Copilot and OpenCode hooks, event logs, plugin and hub are deleted. `grove-next integration uninstall copilot` still removes entries older installs wrote.

## Consequences

- Minimum versions: Claude 2.1.309, Copilot 1.0.107, OpenCode 2.2.6. Older versions show `unknown`.
- A turn that finishes while core is down shows idle, not finished, and raises no attention notification.
- A Copilot session change inside one tab is no longer followed; resume uses the last known id.
- OpenCode shows needs-you/permission only where its `permission` is set to `ask`.
- An older Claude install, with entries for status events, shows Out of date until Update replaces it with the SessionStart entry.
