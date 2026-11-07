# Ticket: Move Grove v2 agent status to OSC 7501 only

Move Grove v2 (next/) agent status to OSC 7501 only, replacing the per-agent hook/service/spool sources for Claude, Copilot and OpenCode. Spec: https://superlogical.com/rex/docs/build/program-status. The verified spike finding is in 02-research.md.

Decisions already made by the human in a grill-me session (fixed, not re-asked):

1. The holder (next/packages/holder, @xterm/headless) parses OSC 7501 and writes the `ESC]7501;?ESC\` query reply into the PTY before any CSI c reply. The UI only renders. The holder forwards status to core.
2. A tab with no 7501 report shows `unknown`, with no fallback to the old sources. Show a minimum-version hint per agent (Copilot >= 1.0.107, OpenCode >= 2.2.6, Claude as tested 2.1.309).
3. Only the root record (no `id=`) decides a tab's status. v2 has no per-terminal child-record model.
4. Mapping: working=working, idle=idle, done=finished, error=needs-you/error, blocked with kind permission|question|auth = needs-you with that reason, blocked with no kind = needs-you/permission. Add a new needs-you reason `auth` (alert text "Needs sign-in", ui/alerts.ts; diff-model.ts already treats non-error reasons as waiting).
5. `finished` = the root leaves working or blocked into idle or done (OpenCode never sends `done`; an Esc interrupt also ends as finished, as the old Claude idle-prompt logic does). A repeated idle stays idle.
6. Keep a minimal id-only source, separate from status, for the agent's resume id (Claude /clear, hand-started tabs via discover()). Hooks no longer mean status.
7. Delete the silence watchdog (status/watchdog.ts) and screen cross-check (status/cross-check.ts) and their timing options. PTY exit is the only reset to unknown.
8. After the new path works, delete the old status sources: Claude hook spool and hook.mjs, Copilot hooks/events, OpenCode hub/normalise, as far as they only carried status. Reuse proven old logic where it still applies (port, do not reinvent).

Plan risks to carry as explicit slices: `error` is unverified for all three agents (verify on a real failure, e.g. an auth failure, before deleting old paths); ordering against a real xterm.js device-attributes reply is untested; OpenCode `blocked` only appeared with a project opencode.json permission=ask. Commit directly on master per the project rule.
