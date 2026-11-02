# Ticket: notification tiers

Option A: rule-based notification tiers for the Grove app, working across all agent kinds (Claude, OpenCode, Copilot, and terminal where applicable).

Goals: use Session.parentId so a child finishing without error is silent (only parent state changes reach the human); child permission/question prompts, failures, parent halts, and top-level finishes still interrupt; add a real 'failed' status across all agent sources (Claude StopFailure, Copilot abort/shutdown, OpenCode errors) since there is no error state today; per-session mute; presence check (skip when window focused/user active).

Context from research: notifyTransitions in src/core/core.ts:589-599, status reducer src/core/status.ts, sources in src/core/claude, copilot, opencode, terminalActivity.ts, notification trigger in src/main/index.ts:~117-137, sound in src/main/sound.ts, global sounds:false is the only setting today. Anthropic's pattern: blocked is distinct from done, tiered interrupts, presence gating.

Motivation (from the human): many notifications; with a parent session and children, if nothing goes wrong the human only needs to know the parent is happy and started the next slice, not that each child finished.

## Scope change (2026-11-02, from the human)

The narrow notification-tier framing was dropped. The human wants Grove to work for them: not hundreds of mostly-unneeded notifications, no hand-holding of agents; agents orchestrate and the human leads only when needed. The sidebar is messy: hard to see what is important and hard to find the way back to where they were. Direction agreed: every session has an owner (the human or a parent agent); events go to the owner; children's routine events go to the parent agent, which handles or escalates with a one-line reason; the sidebar gets zones: Needs you, Ready to review, Running (handled), Where you were. A superorchestrator is the root owner. Open: whether the statuses are set manually (the existing workflow status), automatically by rules, by agents themselves, or by a small fast classifier model. Earlier answers kept: A2 (a clean-finished child keeps its finished look on its own row but is not counted in "N waiting" / cmd+.), A3 (no new failed state, failures unchanged).
