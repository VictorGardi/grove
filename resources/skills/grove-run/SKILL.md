---
name: grove-run
description: Build an approved auto-flow plan one slice at a time, each slice in its own child Grove session in a shared worktree, orchestrated by a session started inside that worktree, unattended after a slice-1 review gate (skippable with `--no-review`), with a final review (execution half of the grove auto flow). Load when the human wants to run, continue, resume or `--continue` a halted or stopped approved auto plan.
license: MIT
---

# grove-run

## Purpose

Execution half of the `auto` flow. Three modes, told apart by "Mode" below:

- **Hand-off** (run from the planning session in the main checkout): does the
  gates, then starts the **orchestrator** as a new top-level session in a new
  worktree on branch `feature/<slug>-<profile>` (profile `inherit` when none is
  active) and stops. It orchestrates nothing.
- **Orchestrator** (a session whose cwd is the run worktree): starts one child
  Grove session per slice in its own checkout, ends its turn until the child
  reports, and checks the result in git. The human is asked only after slice 1
  (unless `--no-review`), after every slice with `--review-each`, and after the
  last slice (continue, fix with a comment, or stop); other slices run
  unattended. Because it lives in the worktree, the app shows the right branch
  for the session that drives the run and nothing needs permission outside it.
- **Child** (`--slice N`): load `references/slice-mode.md` and follow only it.

A profile (`--profile P` or the config's `profile`) sets the agent and model per
role (`references/roles.md`); the slice child is launched as the `planner`'s
agent with the `planner` model. The orchestrator runs as the planning session's
agent on the default model (no role: it only orchestrates). `--continue` resumes
a stopped run per `references/continue.md`.

## When to use / not use

- Use after `grove-approve <slug> plan`, from the planning session (it hands off
  to an orchestrator in the worktree). Re-invoking resumes: finished slices are
  found from `04-run.md` on the run branch.
- Do not use to change the plan, and do not run it without the Grove app.

## Inputs

`<slug> [--continue] [--profile P] [--review-each] [--no-review]` (hand-off and
orchestrator; `--orchestrator` is added only by the hand-off, never by the human)
or `<slug> --slice N [--profile P]` (child). `grove.config.json`
(`artifactRoot`, `profile`, `profiles`).

- `--no-review`: no human stop after slice 1; the run goes through every slice
  unattended. Plain words count too ("skip slice 1 review", "no review gate",
  "run all slices without approval"). The **final review after the last slice is
  kept**. Still halts the run: a halted slice (failed verification, fix rounds
  exhausted, a fix that would change a Decision or the outcome), a slice that did
  not finish in git, a child waiting on a permission prompt or question, and a
  failed gate. Nothing is approved without the human. It is recorded as
  `Review gate: none` in `04-run.md` and kept on `--continue`. It conflicts with
  `--review-each` (stop and say so). Neither `grove-auto` nor `grove.config.json`
  carries it; it is given to `grove-run` on each fresh run.

## Mode

Orchestrator mode = this session's cwd is a linked worktree
(`git rev-parse --git-dir` differs from `git rev-parse --git-common-dir`), the
branch (`git branch --show-current`) starts with `feature/<slug>-` and
`git cat-file -e HEAD:<artifactRoot>/<slug>/03-plan.md` succeeds. The
`--orchestrator` marker, when given, must agree: marker present but the cwd test
failing means stop with "not in the run worktree" (never hand off again, so no
loop). Marker absent but the cwd test passing is still orchestrator mode (the
human invoked it inside the worktree). Otherwise, and only then, it is hand-off
mode. `--slice N` is child mode regardless.

## Preconditions & gates

Child mode: skip this section; follow `references/slice-mode.md`.

Hand-off and orchestrator mode, all required (`--force` is not available here):

- `grove.config.json` exists, is tracked (`git ls-files --error-unmatch grove.config.json`
  ok) and, in hand-off mode, unchanged (`git status --porcelain -- grove.config.json` empty).
- `<artifactRoot>/<slug>/feature.md` has `flow: auto`.
- `01-outcome.md`, `02-research.md`, `03-plan.md` are all `status: approved`;
  otherwise stop and name `grove-approve <slug> plan`. (The orchestrator reads
  these at HEAD of its branch: the files of the plan commit.)
- Hand-off mode only: `git status --porcelain -- <artifactRoot>/<slug>/ grove.config.json` is empty.
  If not, ask through the question tool whether to commit the folder and config
  together as `<slug>: approved plan`;
  commit on yes, stop on no. With `--continue` skip this question when the
  worktree for the run exists. Every other gate applies to `--continue` too.
  The orchestrator skips this check: its worktree is dirty mid-run on purpose.
- `--no-review` with `--review-each`: stop, they conflict.
- You are inside a Grove session: `grove ls --json` lists `$GROVE_SESSION_ID`.
  Otherwise stop: grove-run needs the Grove app.

## Process

**Hand-off mode** (steps H1 to H3), then stop. **Orchestrator mode**: steps 1 to
6. In orchestrator mode `<worktree>` is the session's own checkout root
(`git rev-parse --show-toplevel`) and git is run there directly, never with
`-C`; in hand-off mode `<worktree>` is the path from `git worktree list --porcelain`.

### Hand-off (planning session, main checkout)

H1. **Resolve.** With `--continue`, follow `references/continue.md` instead of
   the rest of this step (never create a new branch with `--continue`). Resolve
   each role's agent and model per `references/roles.md` (`--profile P`, else
   the config's `profile`, else `inherit`) only to fail early: an unknown profile
   or an unsupported agent stops the skill. Plan commit =
   `git log -1 --format=%H -- <artifactRoot>/<slug>/03-plan.md`. Branch =
   `feature/<slug>-<profile>`. Everything about an existing run is read from the
   branch ref, not the worktree path: `git show <branch>:<artifactRoot>/<slug>/04-run.md`,
   `git log -1 --format=%s <branch>`. **Stale** = the `Plan commit:` in the header
   of that committed `04-run.md` differs from the current plan commit, or
   `03-plan.md`'s `version` is newer than `04-run.md`'s `based_on`. A stale run is
   never resumed: start a new run on the next free `-2`, `-3` branch from the new
   plan commit. **Resume** = a worktree for that branch already exists
   (`git worktree list --porcelain`), is not stale and has a slice not done. If the
   branch tip is a halt commit (`<slug>: slice N halted`), stop with "Halted at
   slice N: options in <worktree>/<artifactRoot>/<slug>/04-run.md; run `grove-run
   <slug> --continue` in the run's orchestrator session (or here)". Otherwise a
   resume is handed off like `--continue` (H2, existing worktree). Use the `-2`,
   `-3` suffix only when the existing branch is stale, all its slices are done, or
   it has no worktree. Slices = the `### Slice N.` headings in `03-plan.md`. A
   slice is done when `git show <branch>:<artifactRoot>/<slug>/04-run.md` has
   `## Slice N` with `Status: done` and a non-empty `Commit:` line, confirmed by a
   git log subject `<slug>: slice N — <outcome>` on the branch.
H2. **Start the orchestrator.** A NEW TOP-LEVEL session: no `--child`, no
   `--parent`, never a child of this session. Agent = this session's own agent;
   no `--model` (the orchestrator has no role and runs on that agent's default).
   Label = `run orchestrator`, plus ` #<n>` when the branch suffix is `-<n>`.
   Fresh run (no worktree yet):
   `grove new <own agent> --worktree --branch <branch> --base <plan-commit> --label "<label>" --link <slug> --prompt "<orchestrator prompt>"`
   Existing run worktree (resume or `--continue`): the same without `--worktree`,
   `--branch`, `--base`, and with `--cwd <worktree>`. Before starting it, check
   `grove ls --json` for a live session whose `cwd` is that worktree, with
   `feature` `<slug>`, no `parent` and a label starting `run orchestrator`: if one
   exists, start nothing and hand off to it (H3). `--link <slug>` pins the session
   to the feature (checked against this checkout, where the plan folder is
   committed); `grove new` prints the orchestrator's id.
   Orchestrator prompt: "Load the grove-run skill and follow it exactly. Arguments:
   <slug> --orchestrator --profile <P> [--continue] [--review-each] [--no-review]"
   plus the line `Plan commit: <sha>` (the plan commit of H1). Forward `--continue`,
   `--review-each` and `--no-review` exactly as given here; never add flags the human
   did not give (a run's stored `Review gate:` is read by the orchestrator).
H3. **Hand off and stop.** Final message, nothing after it: the orchestrator's id
   and label, the branch, the worktree path, "switch to <label> in the sidebar: it
   runs the slices and asks you only at the review gates (slice 1 unless
   `--no-review`, the last slice, and every slice with `--review-each`)"; when
   `--no-review` was given, say plainly that the run will not stop after slice 1
   and still halts on failure, and the final review is kept; and the permission
   note: the run uses the human's own permission settings for the orchestrator's agent
   and the planner's agent, a worktree starts without the main checkout's untracked
   local settings (Claude: `.claude/settings.local.json`), so allow the Bash
   prefixes `grove new`, `grove send`, `grove status`, `grove kill`, `grove ls`,
   `grove read`, `grove wait`, `grove progress`, `git` before it stalls. This
   session does not poll, wait, send, mark anything done or write any file.

### Orchestrator

1. **Resolve.** Orchestrator mode only. With `--continue`, follow
   `references/continue.md`. Roles: per `references/roles.md` from the worktree's
   committed `grove.config.json` (`--profile P`, else its `profile`, else
   `inherit`) before slice 1; once `04-run.md` exists (HEAD), the `Profile:`,
   `Roles:`, `Agents:` and `Review gate:` lines there win, so the planner never
   changes mid-run. An unknown profile or unsupported agent stops the skill.
   Plan commit = `git log -1 --format=%H -- <artifactRoot>/<slug>/03-plan.md`
   (on this branch it is the plan the run was cut from; the orchestrator never reads
   the main checkout). **Stale** = that plan commit differs from the prompt's
   `Plan commit:` line, or from the `Plan commit:` in the header of the committed
   `04-run.md` (when it exists), or `03-plan.md`'s `version` is newer than
   `04-run.md`'s `based_on`. A stale run is never orchestrated: stop with "this run
   is for an older plan; start a new run with `grove-run <slug>` from the main
   checkout". A plan changed in the main checkout after the hand-off is caught by
   the hand-off or `--continue` run from main and by `grove-approve <slug> run`,
   not here. Review gate = `--no-review` (this invocation), else the `Review gate:`
   line of `04-run.md` (`none`), else slice 1. A halt commit at HEAD
   (`<slug>: slice N halted`): do not start a child; stop with "Halted at slice N:
   options in <worktree>/<artifactRoot>/<slug>/04-run.md; run `grove-run <slug>
   --continue`". Slices = the `### Slice N.` headings in `03-plan.md`. A slice is
   done when `git show HEAD:<artifactRoot>/<slug>/04-run.md` has `## Slice N` with
   `Status: done` and a non-empty `Commit:` line, confirmed by a git log subject
   `<slug>: slice N — <outcome>` on the branch. Next = the first slice not done.
2. **Start the slice.** Label = `<n> <short title>`: the slice number, a space,
   then two to four lowercase words from the slice heading (`### Slice N. ...` in
   `03-plan.md`), e.g. `3 boards and project page`; never the feature name (the
   child already carries the feature link and the orchestrator id). A second child
   for the same slice (retry, or the `Decision:` child after a halt) gets ` #<k>`
   appended, k = the number of existing children for that slice + 1 (`6 mockup
   round #2`); the first has no suffix. **Finding a slice's children:** the
   entries of `grove ls --all --json` with `feature` equal to `<slug>`, `parent`
   set, and a `label` that starts with `<n> ` (the number then a space, so slice 1
   never matches slice 10); the newest wins (the highest `#k`, no suffix = 1; on a
   tie the last in the list). **Addressing a child:** `grove status`, `grove send`,
   `grove wait` and `grove kill` match a session id (or id prefix) or an exact label,
   never a label prefix, and labels contain spaces and can be a prefix of one another
   (`6 mockup round` and `6 mockup round #2`), so always address a child by its
   session **id** (`<child id>`): the id `grove new` prints, or, after the turn
   ended and the orchestrator no longer has it (on "continue" or `--continue`), the `id`
   of the entry found by the lookup above. Where this skill writes `<label>` in a
   message it is only for the human to read. Child prompt: "Load the grove-run skill and follow
   it exactly. Arguments: <slug> --slice <N> --profile <P>" plus the lines `Label: <label>`,
   `Parent: <id>`, `Review gate: <slice 1|none>`,
   `Roles: cto=<m|inherit> researcher=<m|inherit> planner=<m|inherit> reviewer=<m|inherit> implementer=<m|inherit>`
   and `Agents: cto=<agent> researcher=<agent> planner=<agent> reviewer=<agent> implementer=<agent>`
   (resolved, one token per role, in that order; a subagent role without
   `agent` gets the planner's agent, the planner without `agent` the orchestrator's
   own agent), where id is the current value of `$GROVE_SESSION_ID` (expanded, no angle brackets or variable name in the prompt). Start the child without `--wait`.
   - Every slice, slice 1 included: `grove new <planner agent> --child --relation slice --cwd <worktree> --label "<label>" --link <slug> [--model <planner model>] --prompt "<child prompt>"`
     (never `--worktree`, `--branch` or `--base`: the worktree already exists and is this
     session's own. `--relation slice` marks the session as an auto-run slice; `--link <slug>` links the child to the feature, so the app offers it as a
     send target for comments on the feature's artifacts. If `grove new` fails with an
     unknown or invalid `--relation` option (an older app), run it again without that
     flag. `--model <planner model>` is added only when the `planner` role has a model; omit it
     when it inherits. `grove new` prints the child's id: keep it as `<child id>`)
   - Right after the child starts, run `grove progress <own-id> <done>/<total> --current N` (`N` is the slice just started, `done` the
     slices git-confirmed so far), so the orchestrator's bar reads "slice N/M". If it is rejected as an unknown or invalid
     `--current` option (an older app), run `grove progress <own-id> <done>/<total>` without that flag.
3. **End the turn.** Final line: "Started slice N in <label>; it will report
   here". No background or unbounded `grove wait` loop (bounded `--timeout 600` calls only, see "A child's prompt"). The orchestrator wakes when a message
   `SLICE n: done|halted — <one line>` arrives from the child (after a fix:
   `SLICE n: done — fixed: <line>`). `halted`: stop as in step 4, except a
   `halted` that answers a fix request (see step 5, fix with a comment).
   - **A child's prompt.** After starting a child, the orchestrator does not end its turn at once:
     it runs `grove wait <child id> --timeout 600` (one call, never in a background loop).
     Exit 0 or 124: end the turn as above (the report arrives as a message; on 124 with the
     child still working, wait once more; a second 124: end the turn). Exit 5: the child ended; go to the git check in
     step 4. A child waiting on a permission or question is still running for `wait`
     (no special exit code); the human sees that prompt in the sidebar and answers it in the
     child. The orchestrator never answers a child's prompt and never `send`s into a child that is
     waiting on one.
   - Silence: a child that never reports (crash, or a permission prompt or question, shown
     as waiting in the sidebar for the human to answer) is seen by the human via the label. When the
     human says "continue" here and the child is waiting, say which child (name the label)
     to answer the prompt in, then say "continue" here or run
     `grove-run <slug> --continue`. When the
     human says "continue" here, check `git log -1 --format=%s`,
     `04-run.md` and `grove ls` first: slice finished but report lost, go to
     step 4; child still waiting, tell the human to answer in that child and
     start nothing; child still working: say so, start nothing, end the turn;
     child gone with no matching commit: stop as in the git check. Never `send` into a child waiting on a prompt; never start a
     later slice without a report or a git-confirmed finish.
4. **Check in git.** `git log -1 --format=%s` must equal
   `<slug>: slice N — <outcome>` and `git rev-list --count
   <plan-commit>..HEAD` must equal N (one commit per slice), for every `done`
   report (first run, retry, `Decision:` child, fix); the message alone is never
   trusted. Otherwise:
   - HEAD subject `<slug>: slice N halted` (the halt commit; the report was
     `halted`, or HEAD says so after "continue"): stop with "Halted at slice N:
     options in <worktree>/<artifactRoot>/<slug>/04-run.md"; leave the child
     (<label>) running, no later slice starts. The human then runs
     `grove-run <slug> --continue` (here, or from the main checkout).
   - Any other mismatch, or a `halted` report without the halt subject: stop
     with "Slice N did not finish in <label>: see
     <worktree>/<artifactRoot>/<slug>/04-run.md"; leave the child running; the
     human decides (`grove-run <slug> --continue`). No retries.
5. **Gate.** The human is asked after slice 1 (always, unless the review gate is
   `none`), after every slice when `--review-each` is given, and after the last
   slice (final review, always). Every other slice has no question: after the git
   check, `grove status <child id> done`
   on the finished child (it stays open), start the next child (step 2) and end the turn (step 3). After each git-confirmed slice, also run `grove progress <own-id> <done>/<total>` (add `--current N` with the slice just finished until the next child starts, if the flag was accepted).
   Slices 2..N (all of 1..N-1 when the review gate is `none`) then run with no human prompt. At a gate:
   - Show a summary in the format of the `auto` review gates section of
     `references/gates.md`: what was built, review verdict and fix rounds
     (from the slice's section in
     `git show HEAD:<artifactRoot>/<slug>/04-run.md`),
     deviations, and where the diff is (the worktree project in the app, one
     click from the sidebar; not a link).
   - The slice-1 summary also lists the Bash command prefixes this session needs
     allowed so later slices do not stall: `grove new`, `grove send`,
     `grove status`, `grove kill`, `grove ls`, `grove read`, `grove wait`, `grove progress`, `git`. Say plainly
     that the run uses the human's own permission settings for the agent that
     runs it (Claude: a repo without pre-approved edits and project commands
     halts at the first prompt; OpenCode: its `permission` config, below), and
     that for the children it is the children's agent (the planner's) that
     matters, and that they can allow those prefixes ("don't ask again")
     before answering continue. In OpenCode, permissions come from the human's
     OpenCode `permission` config: the default allows edits and shell but asks
     for `external_directory` and `.env` reads, and an unattended run stops at
     any `ask`, so set `allow` for what the run needs (the `grove` and `git`
     commands, the project's commands). Grove never starts OpenCode with `--auto`,
     so only the `permission` config decides. A question in a child still halts
     the run (the question tool there is `question`).
   - Ask through the question tool, one question, options *continue*, *fix
     with a comment*, *stop* (last slice: *finish*, *fix with a comment*,
     *stop*). A one-slice plan has slice 1 as the last slice: its gate is the
     final one (finish / fix / stop) even with `--no-review`, and it still carries the slice-1
     permission-prefix note above.
   - **continue / finish**: `grove status <child id> done` on the finished child
     (only now; never kill it). Continue: go to step 2 for the next slice and end the turn (step
     3). Finish: go to step 6.
   - **fix with a comment**: the comment is the question tool's other/free
     text; if empty, ask once more for it through the question tool. Then
     `grove send <child id> "Fix slice N: <comment>"` to the live child (no
     `--wait`) and end the turn. The child amends its slice commit and
     reports `SLICE N: done — fixed: <line>`. On that report, check git again
     (step 4: HEAD subject still `<slug>: slice N — <outcome>`, and
     `git rev-list --count <plan-commit>..HEAD` equals N, N being
     the slice number: one commit per slice; a fix amends, never adds a
     commit), then show the updated summary and ask the gate question again.
     If the child instead reports `SLICE N: halted — <reason>` in answer to the
     fix, the fix would have changed a Decision or the outcome, so nothing
     changed and the slice commit is still valid: do not go to step 4's "did
     not finish" stop. Show the one-line reason and ask the same gate question
     again (continue / fix with a comment / stop; finish / fix / stop on the
     last slice). A `halted` that is not an answer to a fix keeps the normal
     handling. The silence rule of step 3 applies.
   - **stop**: `grove status <child id> done`, print where things are (worktree,
     branch, `04-run.md` in the worktree) and end.
6. **After the last slice.** Once its gate is answered *finish* and the child
   is marked done, print the hand-off as the final message:
   the worktree path (this session's own) and branch; that `04-run.md` lives there with its
   `## Final summary`; that the human approves from here by running
   `/grove-approve <slug> run` in this session (already in the worktree), or with the
   ready-to-paste line with real values filled in,
   `grove new <this session's own agent> --cwd <worktree> --prompt "/grove-approve <slug> run"`;
   and the steps after approval: commit the approved `04-run.md` on the run
   branch as `<slug>: approve run`, then merge or open a PR using the PR
   description from the final summary. The orchestrator approves nothing.

**Abandoning a run.** When the human says to abandon the run, the session leaves
the branch and worktree in place and prints `git worktree remove <worktree>` and
`git branch -D <branch>` (to run from the main checkout, never from inside the
worktree). Only a session in the main checkout runs them, and only if the human
picks that in a question-tool question. An abandoned run is never resumed. To
re-plan, the human runs `grove-auto <slug>`, re-approves with
`grove-approve <slug> plan`, and `grove-run` starts a new run on the next free
`-2`, `-3` branch from the new plan commit.

## Output

Hand-off: one new orchestrator session and a short message; no files besides the
optional `<slug>: approved plan` commit. Orchestrator: commits on
`feature/<slug>-<profile>` in the worktree, one per slice, including
`04-run.md`; at the end, the hand-off message naming `grove-approve <slug> run`.
The orchestrator writes no files.

## Stop conditions

Failed precondition, an unfinished slice, the human choosing stop at a gate,
the last slice's gate answered finish, the human abandoning the run, or (hand-off)
the orchestrator started.

## Rules

- Ask the human only through the question tool (`AskUserQuestion` in Claude, the equivalent in other agents), one question at a time, with the background and your recommendation; never as plain chat text. This includes approval prompts (offer *yes* and *not yet* as options).
- The hand-off asks only the commit-first question, the `--continue` run-choice question; the orchestrator asks the gate questions (slice 1 unless `--no-review`, `--review-each` slices, final), the `--continue` option question and the `--continue` retry / leave-it question; every other slice runs with no prompt.
- The hand-off session never orchestrates, polls or waits; it starts the orchestrator once and stops. The orchestrator is never started with `--child`, and never hands off again.
- The orchestrator never edits files in the worktree (the children do; it runs only read-only git there).
- The orchestrator never reads or writes the main checkout.
- Never start a later slice on a broken base.
- Never mark a child done or kill it before its gate is answered; a finished child is marked done with `grove status <child id> done`, never killed (`grove kill` is only for replacing a live idle child on `--continue` retry); never `send` into a child waiting on a prompt.
- Name roles only; never model names.
- Only `grove-approve`, invoked by the human, approves. This skill approves nothing.
