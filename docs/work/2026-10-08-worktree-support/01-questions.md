---
phase: questions
status: draft
version: 2
based_on: []
repo_heads: ["feature/xirp"]
---

# Worktree support — questions

## Goal

Let a grove session run in its own `git worktree` instead of always sharing its project's single checkout, so concurrent agent sessions on the same repo stop colliding on one working directory and branch.

## Out of scope

- Submodule handling inside a new worktree (the ecosystem standard `git submodule update --init --recursive` is a known follow-up step; not part of this feature)
- Container or VM isolation (worktrees are a git-level mechanism, not a sandbox)
- Changing the single-project-per-repo model for non-worktree folders (the existing `resolveProject` logic for incidental subfolders stays as-is)
- Migrating existing sessions to worktrees (only new sessions)
- Multi-repo worktrees (each worktree belongs to one repo)

## Research questions

1. How does `git worktree add` behave when the target branch already exists locally vs. only remotely? What does `git worktree list --porcelain` report in each case?
2. What is the exact format of `git worktree list --porcelain` output, and how does it indicate a worktree is locked or prunable?
3. How does `git worktree remove` handle uncommitted changes, and what flags force removal? What does `git worktree prune` do and when is it safe?
4. What does `git worktree lock` / `unlock` do, and does locking prevent `prune` / `gc` from removing the worktree?
5. When a worktree is created, does it inherit the parent repo's config (e.g., `core.hooksPath`, `user.*`, `remote.*`), or are there settings that must be copied manually?
6. How does the existing `readBranch()` function (which follows a worktree's `.git` file redirect) behave for a worktree created with `git worktree add` — does it correctly return the branch name?
7. How does the current diff computation (`computeDiff`) resolve the repo root for a session whose `cwd` is a worktree directory? Does it correctly find the worktree's own root via `git rev-parse --show-toplevel`?
8. How does `resolveProject()` in `cliOps.ts` behave when given a worktree directory — does it register the worktree as a new project, or find the existing parent project?
9. What does the current `Project` schema look like in the config file (`ConfigFile.projects`), and what migration pattern was used when `Session.cwd` was added (ADR 0029, state file v3→v4)?
10. How does the artifact viewer's `setRendered()` compute the `rendered` path relative to `project.path`, and why does it produce `..` paths for a worktree session?
11. How does feature discovery (`resolveRoot`, `watchers.watchRoot`) scope to `project.path` today, and what would change if a worktree were its own `Project` with `parentProjectId`?
12. How does auto-linking (`slugFor`) resolve paths against `projectPath`, and what breaks when the session's cwd is a worktree?

## Product questions for the human

1. **Worktree session modeling**: Should a worktree session be modeled as its own lightweight `Project` (with a `parentProjectId`/`worktreeOf` field so the sidebar nests it under its parent repo), or should it stay a plain `Session.cwd` under the existing project?
   - **Decision (reversed 2026-10-10; originally "Plain `Session.cwd`")**: Each worktree is its own lightweight `Project`. Its `path` is the worktree root, so feature discovery, the watcher, the diff viewer and auto-link are correct with no change to any of them. `worktreeOf` marks the parent for **nesting only** — it is not the authority for which repo a checkout belongs to.
   - **Why it reversed**: three reasons, none available on 2026-10-08. The research already argued for this and the original answer overrode it (`02-research.md` § *Design implication*). Multi-repo sandboxing makes it load-bearing — the sandbox mounts exactly the session's working directory at host-identical paths, an invariant that only holds if that directory *is* a project path. And the disk location at Q4 already forces this outcome in code (`02-research.md` § *What the code already does with a worktree directory*).
   - **Migrated to the design phase** as a one-way door: this is a persisted-shape change other subsystems will copy, not a two-way product preference. See `03-design.md` W1.
2. **Auto-create vs. ask**: When starting a session that wants a worktree, should the app auto-create a worktree on a new branch (e.g., `grove/feature-xyz`) or always ask the user first (pick/create branch, confirm path)?
   - **Decision**: CLI flag only for v1 — `grove new --worktree --branch <name>` creates it; GUI just uses the CLI flag; defer GUI flow to later.
3. **Cleanup policy**: On session end, what should happen to the worktree — auto-remove, keep-until-merged, or manual only? (Ecosystem recommends keep-until-merged/explicit close; agents' work often needs review after the session ends.)
   - **Decision**: Keep until merged/explicit close — worktree persists after session ends; user removes it manually or via a 'clean up merged' action.
4. **Disk location**: Where do new worktrees live on disk — a sibling directory (e.g., `../repo-worktree-branch`), a hidden cache dir (e.g., `~/.grove/worktrees/repo/branch`), or user-chosen?
   - **Decision**: Hidden cache dir — under `~/.grove/worktrees/<repo>/<branch>` — keeps workspace clean.
   - **Load-bearing, not cosmetic (noted 2026-10-10)**: this answer decides Q1 in code. A worktree outside the repo directory is not contained in the project's path, so `resolveProject` registers it as its own `Project` and collapses `Session.cwd` to `null` (`02-research.md` § *What the code already does with a worktree directory*). Standing.
5. **GUI affordance**: Does the GUI need its own "start session in new worktree" flow (pick/create branch, surface branch-in-use conflicts before `git worktree add`), or is a CLI flag (`grove new --worktree`) enough for a first cut?
   - **Decision**: CLI flag only for v1 (per Q2) — `grove new --worktree --branch <name>`; GUI defers to CLI.
6. **Branch naming**: If auto-creating (or via CLI flag), what branch naming scheme? This applies when the user provides a branch name via `--branch`.
   - **Decision**: Just use `--branch` as-is — no prefix added; user supplies full branch name (e.g., `--branch fix-auth-bug`).
7. **Submodules**: Should the app auto-run `git submodule update --init --recursive` after creating a worktree, or leave it to the user/agent?
   - **Decision**: Auto-run submodule update — run automatically after worktree creation; no-op if no submodules exist.

## Size verdict

**M** — Medium. Reasons (revised 2026-10-10, after Q1 reversed):
- Net-new git-worktree lifecycle module (create/remove/list/prune/lock) — from scratch
- One **optional** `Project.worktreeOf` field — additive, so `ConfigFile.schemaVersion` stays 1 and **no config migration** is needed (`readVersioned` returns unknown keys verbatim, `src/core/store/jsonFile.ts:31`)
- Repo grouping derived from git at load, not stored as authority
- Nested project list in the sidebar and Projects tab; features deduped by (repo, slug) in the view
- CLI flag `grove new --worktree --branch` for v1; GUI flow deferred
- **No changes to `setRendered`, `resolveRoot`, the watcher wiring or `slugFor`** — with the worktree as its own Project, `project.path` is the worktree root and all four are already correct
- Roughly comparable in scope to ADR 0021 (session diff) or ADR 0027 (grove CLI)

## Open questions

- None — all product questions resolved.

## Flow proposal

**standard** — size M, two two-way decisions (modeling choice, cleanup policy) and one schema change. Design and slices fit one review.

Confirm? (yes / change to small / change to full)