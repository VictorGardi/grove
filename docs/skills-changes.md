# Changes needed in grove-skills

Changes the app relies on that belong in the grove-skills repo, not here.
Each names the app design that needs it.

## 1. `implementation` approval unit (ADR 0014)

Status: built in grove-skills on 2026-10-05 (uncommitted there at the time).

Needed by: `docs/work/2026-10-05-02-workflow-discovery-sidebar/03-design.md` (D4).

- `shared/approve.md`, "Approval units": add unit `implementation`, file
  `06-implementation.md`, used when the human runs
  `grove-approve <slug> implementation` after the last slice.
- Validation: every slice in `04-structure.md` has a `## Slice N` section in
  `05-plan.md` with no `- [ ]` left; `06-implementation.md` passes the usual
  content gates. On yes: `status: approved`, `approved_at`; nothing goes
  stale.
- `shared/contract.md`: state that an approved `06-implementation.md` marks
  the feature done.
- `grove-implement`: after the last slice, tell the human to run
  `grove-approve <slug> implementation`.
- Not in grove-skills: existing finished features (walking skeleton, visual
  foundation) need their 06 approved once the unit exists.

## 2. Hub / multi-repo support (later)

Prerequisite for a later hub (epic design, two-way row "Skills changes");
reserved `{repo}`, `{repo_path}` and `per_repo` in `workflow.yaml`. Not
specified yet.
