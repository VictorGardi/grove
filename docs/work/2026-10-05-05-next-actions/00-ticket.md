Source: the epic's 04-structure.md (v5), child entry 5, verbatim. No separate ticket: the human started this child with `grove-start next actions feature` on 2026-10-06.

### 5. `2026-10-05-05-next-actions`

- **Goal:** move a feature forward from its page.
- **Outcome:** the feature page shows the current stage's next-action buttons
  from `workflow.yaml`. Each one starts a session that is already linked and
  prompted (`--prompt`) in the templated cwd. A `needs_input` action (Revise)
  asks for text first. Approve and other follow-ups are pasted into an idle
  linked session if one exists, and start a new linked session otherwise.
  Card states `ready` and `needs-review` drive which buttons are offered.
- **Scope:** E-D2 (actions, template variables, `stage_actions`), E-D3
  (bracketed paste), E-D5 (idle detection for the paste target). Design:
  Desired state 6; "Sessions, backend and status" flow *Next action*; two-way
  row Prompt injection.
- **Depends on:** 2, 3.
- **Size:** 2 days, about 4 slices.
