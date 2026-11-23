# Decision log: pinned spaces

1. Scope: pin spaces only (worktree spaces are spaces); tabs not pinnable. Decided by user, after mockups A/B/C (mockup: https://claude.ai/artifact/2VDzKEe7Snb3o5ujVyoAeq).
2. (partly superseded by 10: no pin mark in the window, only in the sidebar and Go to) Taken as recommended by user ("take your recommendations"): pin = personal come-back list; pin vanishes with its space; pin mark wherever the space appears, Go to lists pinned first; no cap, no notes, no expiry; saved across restarts and shared across windows.
3. (superseded by 10; the shortcut part stands) New requirement from user: the focused window shows whether the space is pinned; a keyboard shortcut toggles the pin.
   Open interpretation: "focussed window" read as the window the user is working in, showing the pin state of the space they are in. To confirm.

## Round 1 (respondent: round-1-respondent.md)
4. Pins are saved in Grove's own saved state, tied to the space; they vanish with it. ADR warranted. respondent: inferred (high home, medium shape).
5. Cmd+1..9 numbers the tree only; Pinned group rows have no number; active space highlighted in both copies. respondent: inferred.
6. Pinned group order = order of pinning, newest at the bottom. respondent: inferred (medium; cheap to change).
7. Quiet spaces: a pinned space is never quiet in the Pinned group or Go to; tree copy follows the normal quiet rule. respondent: inferred; count wording cheap to change.
8. No auto-unpin when a pinned worktree folder is deleted outside Grove; the Pinned group is not foldable; nothing drawn when nothing is pinned; Pin/Unpin also in the space context menu; Go to never pins. respondent: inferred / decided by glossary.
9. Shortcut default: Cmd+Shift+P (free in Grove, rebindable; Cmd+Shift+D is taken by Changes). Interviewer decision, below altitude.
Escalated to user: Q4 where the window shows the pin (low-medium confidence; grid pane can hold another space's tab); Q5 Go to pinned-first vs needs-you.
Glossary updated: Pin, Pinned group.

## User answers after round 1
10. Window-level indicator: user said "skip that pin for now, only sidebar". Dropped from scope. Shortcut stays. Decided by user.
11. Go to with no search words: pinned first within each group (needs-you, finished, ... as today); pin mark shown; search ranking unchanged; Go to never pins. Decided by user.

## Phase 4
12. ADR 0007 written (user approved). No rows reopened. Next step recommended: to-spec first (several slices: core state + protocol, sidebar group, Go to order and mark, shortcut and context menu).
