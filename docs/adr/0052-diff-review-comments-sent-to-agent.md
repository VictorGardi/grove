# 0052. Diff review comments live in the core and are sent to the active tab's agent on demand

Date: 2026-11-06

## Status

Accepted

## Context

The Changes panel of grove-next shows the diff of the active tab's folder, read only. The human wants to review it like a pull request (file cards, viewed marks, line comments) and to give those comments to the agent that made the changes. The core already has `tabs.write` (bytes to a tab) and the CLI already pastes text into tabs. Comments do not exist yet. Decisions and the mockup are in `docs/work/2026-11-06-feature-modules/review-comments-decisions.md`.

## Decision

- **Comments are stored by the core, per folder**, in `state.json` next to `diffPrefs`, reached through `diff.comments.*` RPCs. Each is anchored by file, side, line and the line's text. A comment whose text no longer matches is flagged "outdated"; it is never moved or dropped silently.
- **States are pending, sent and resolved.** Send marks the comments it sent. Only pending ones are included, so a second send never repeats old feedback.
- **Sending is a human act.** One "Send to <agent>" press pastes all pending comments into the active tab, unsubmitted (paste only), and focuses that tab. Nothing is sent as a comment is written, and nothing is ever submitted for the human.
- **The target is the active tab.** Sending is disabled for a shell or a dead tab, and while the agent waits on a permission prompt or question. While it works, sending is allowed with a notice.
- **The message is markdown** (path and line, a fenced snippet with two lines of context, the comment), the same for every agent kind.
- **The window pastes through `tabs.write`**, as the CLI does. No new core transport and no agent-specific code.
- **Built in three slices**: restyle (no behaviour change), comments, send.

## Consequences

- A new section in `state.json` and new protocol methods. The file loads unchanged without the section, as with `diffPrefs`.
- The text anchor makes drift visible, but a comment on a line that moved is "outdated" until the human deals with it.
- The paste helper in `cli/paste.ts` has to be shared with the window or reimplemented there; which one is a plan detail.
- Comments written in a worktree belong to that folder, not to the repository, so they do not follow a branch.
- Review comments are separate from the window modules of ADR 0051: the diff module owns the panel, and the core part (comments store) is the first thing the deferred core-side registry would have had to hold.
