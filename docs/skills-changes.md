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

## 3. `grove progress --current N` (current slice on the parent bar)

Status: not yet built in grove-skills (the app side is done).

Needed by: the parent bar showing "slice N/M" during an auto run.

- `grove-run`: right after starting each slice's child, the parent runs
  `grove progress <own-id> <done>/<total> --current N`; if the app rejects
  `--current` (older app), it retries without the flag. The existing call after
  a git-confirmed slice stays.
- `grove`: document `--current N` in the command list and the `progress` note.
- Installed copies (for example under `~/.claude/skills`) need the same edit.

## 4. `grove-run` hands off to an orchestrator in the worktree; `--no-review`

Status: edited in `resources/skills/grove-run` (this repo); not yet in grove-skills.

Needed by: the app showing the right branch for the session that drives a run, and
runs under permission scopes that cannot read the worktree from the main checkout.

- `grove-run`: from the planning session (main checkout) it does the gates, then
  `grove new <own agent> --worktree --branch <B> --base <plan-commit> --label "run
  orchestrator" --link <slug> --prompt "... <slug> --orchestrator --profile <p> [flags]"`
  (a top-level session, not `--child`) and stops. The orchestrator (cwd = the run
  worktree) spawns every slice child with `--cwd <its own checkout>`, never
  `--worktree`. `--continue` from main starts a fresh orchestrator with `--cwd <worktree>`.
- `--no-review`: no human stop after slice 1; recorded as `Review gate: none` in
  `04-run.md` and the child prompt; the final review and every halt stay.
- Shared sources (`shared/gates.md`, `shared/contract.md`, `shared/roles.md`) need the
  same edits, then `scripts/sync-shared.sh` in grove-skills. `~/.claude/skills/grove-run`
  is a symlink to `/Users/victor/git/grove-skills/skills/grove-run`: sync it there.
