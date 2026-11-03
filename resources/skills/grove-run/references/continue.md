# grove-run: `--continue` (parent)

Resumes a stopped run (halt, did-not-finish, lost report, permission stop). Same gates as
`SKILL.md`. The parent never edits worktree files; a dirty worktree after a halt is
expected (the failing code is uncommitted), never clean it.

1. **Pick the run.** Candidates = branches `feature/<slug>-*` (`git branch --list`) with a
   worktree (`git worktree list --porcelain`), not stale (stale test as in `SKILL.md`
   step 1), and either a slice not done (done test as in `SKILL.md` step 1) or all slices
   done with the last slice's child still live. `--profile P` selects `feature/<slug>-P`; else
   exactly one candidate is used; several: ask which through the question tool (one
   question, one option per branch); none: stop with "nothing to continue; run grove-run
   <slug>". If the selected (or only) run is stale, stop with "this run is for an older
   plan; start a new run with `grove-run <slug>`, or abandon it (leave branch and
   worktree; removal commands: git worktree remove <path>, git branch -D <branch>)". A
   stale run is never continued.
   Profile = the `Profile:` line in `04-run.md` (preferred; the branch suffix only if
   absent), not the config.
   Resolve the roles for that profile per `references/roles.md` (for the `Roles:` and `Agents:` lines), taking the agents from the `04-run.md` header of the run being continued rather than re-resolving, so the planner's agent never changes mid-run.
   `--review-each` must be given again; it is not remembered.
2. **Lost report.** Before picking N: HEAD subject = `git -C <worktree> log -1
   --format=%s`. If it is `<slug>: slice M — <outcome>` for a slice M whose gate is still
   due (slice 1, any slice with `--review-each`, or the last slice), the gate may not have
   been answered, and M's child (labels starting `<name>-slice-<M>-a` in `grove ls --all
   --json`, the highest `a<k>`) is still live: treat as a report for M and run `SKILL.md`
   step 4/5 for M with that label. This may re-ask a gate already answered: acceptable.
   All slices done: M = the last slice, found the same way; no live child for M: nothing
   to continue, print where things are and end.
   Otherwise **slice N** = the first slice not done.
3. **Find N's child.** `grove ls --all --json`, labels starting `<name>-slice-<N>-a`,
   the highest `a<k>`. HEAD subject as in step 2.
   - a. Finished slice, report lost: handled in step 2.
   - b. `<slug>: slice N halted`: go to step 4.
   - c. Neither, child live (working or waiting, e.g. permission prompt): say "answer the
     prompt in <label>; it will report here", start nothing, end the turn. The live child
     still carries the old `Parent:` id and reports to the original parent session; if this
     is a new parent session, run `--continue` again after answering. If the child is live
     but idle (not waiting on a prompt), or the last stop was "did not finish", ask through
     the question tool (options *retry* / *leave it*) instead; on retry, or if the human
     says retry, `grove kill` it and start a fresh child for slice N with no `Decision:` line and
     the line `Retry: yes` (label per `SKILL.md` step 2).
   - d. Neither, child gone: start a fresh child for slice N with no `Decision:` line and
     the line `Retry: yes` (the worktree as it stands; label per `SKILL.md` step 2), same
     prompt as `SKILL.md` step 2.
4. **Halted.** `grove status <label> done` the leftover child first (do not kill it). Read the options:
   `git -C <worktree> show HEAD:<artifactRoot>/<slug>/04-run.md`; only the latest
   un-numbered `### Options` counts (older ones are `### Options (attempt <n>)`). If the
   human already named an option earlier in this session, use it without asking again.
   Otherwise ask ONE question through the question tool: one option per `#### Option`
   (label = title; description = Pros/Cons and the `Changes design or outcome` value), the
   recommendation first if the file states one. Free text (other) is a custom instruction:
   its question text asks the human to state explicitly whether it changes the design or
   outcome (yes or no); treat a custom choice as `yes` unless the human says no.
5. **Refusal.** An option with `Changes design or outcome: yes` is refused with exactly
   "revise the plan first: `grove-auto <slug>`" (then re-approve with
   `grove-approve <slug> plan`). Start nothing and end the turn.
6. **Otherwise** start a fresh child for slice N (label per `SKILL.md` step 2, `--cwd
   <worktree>`, same prompt as `SKILL.md` step 2 plus the line `Decision: <option title and
   text>`; launched with the `planner` model and as the planner's agent as usual, never `--worktree`/`--branch`/
   `--base`). The child does the `git reset --soft HEAD~1` of the halt commit, records
   `Decision:` in the slice section and ends as exactly one `slice N —` commit (the halt
   commit is folded in). Then end the turn like `SKILL.md` step 3.
