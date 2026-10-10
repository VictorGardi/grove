---
feature: 2026-10-08-worktree-support
phase: design
status: approved
version: 1
created: 2026-10-10
updated: 2026-10-10
approved_at: 2026-10-10
based_on:
  - 01-questions.md@2
  - 02-research.md@2
forced: []
---

# Worktree support — design

## Desired state

1. `grove new claude --worktree --branch fix-auth` creates a `git worktree` under
   `~/.grove/worktrees/grove/`, registers it as its own lightweight `Project`, and
   starts the session there.
2. Its diff, branch, artifact viewer and feature linking are **correct with no change
   to any existing subsystem**, because `project.path` *is* the worktree.
3. The Projects tab and sidebar nest worktrees under their repo; the Features board
   shows **one card per (repo, slug)**, so a worktree's agent is a linked dot on the
   repo's feature, not on a duplicate.
4. Concurrent sessions on one repo stop colliding on a checkout or a branch, and repo
   membership is derived from git, so it cannot drift from reality or dangle.
5. This feature does not decide what a *sandboxed* worktree session does; it records
   the precondition rather than shipping a broken combination.

## Non-goals

- **Multi-repo sessions.** Rejected with a reason: grove's unit of work is the feature
  folder, identified by `projectId + slug`, so a task needing two repos is two features.
  The real blocker is one-diff-per-session (`src/core/diff/watch.ts:10-13` dedupes on a
  single `lastKey`), not the data model. If wanted later the minimum is
  `Session.extraRoots: string[]` — orthogonal to this feature.
- **A GUI worktree flow** (Q2/Q5), and **any change to the sandbox** — W4 sets the
  boundary; the mount rules belong to `2026-10-08-agent-sandboxing`.
- **Auto-cleanup on session end** (Q3), and **migrating existing sessions** onto worktrees.
- **Making incidental subfolders projects.** ADR 0029's precedent stands untouched;
  only a *deliberate, grove-created* worktree becomes its own Project.

## System design

### The model

`Project` keeps its exact current meaning — one path ↔ one id — and grows **one
optional field**: `{ id, name, path, worktreeOf?: string }`. A worktree is a `Project`
whose `path` is the worktree root. `worktreeOf` names the parent and is used for
**nesting only** — never as the authority for which repository a checkout belongs to.

Because `project.path` is the worktree root, four subsystems are correct with no change:
`setRendered`/`projectScope` (`src/core/diff/compute.ts:37,43`), `resolveRoot` and the
watcher wiring (`src/core/core.ts:247-265`), `slugFor` (`:341-342`), and
`safeArtifactPath` (`src/core/artifacts/path.ts`). `runDiff`'s gone-session fallback
(`:415`) becomes correct too — it resolves against the worktree, not the main checkout.

`Project` lives in `config.json`, at `schemaVersion: 1` with **no migrations map**
(`src/core/store/configStore.ts:5`). An optional additive field keeps it at 1:
`readVersioned` returns parsed keys verbatim (`src/core/store/jsonFile.ts:31`), and
`Session.lastFocusedAt?` (`src/shared/types.ts:26`) is the existing precedent. **No
migration, and no exposure to the rename-aside at `jsonFile.ts:36-39`.**

### Repo grouping (D2)

Grouping is **derived from git at load**, not stored. `gitCommonDir(dir): string | null`
follows a worktree's `.git` *file* redirect and reads `<gitdir>/commondir` — a checkout's
own `.git` directory is its common dir; a linked worktree's is the main repo's. It reuses
the `headFile` pattern (`src/core/git.ts:18-26`): **synchronous, no process spawn, one
small read per project at startup.**

`worktreeOf` is written when grove creates a worktree but stays a **hint**; authority is
always the derived common dir. So grouping cannot dangle (a removed parent strands
nothing), cannot be absent (`projectAdd` on a worktree folder groups with no extra work),
and self-corrects against a hand-edited config. The one case derivation cannot classify
is a worktree project whose directory is gone — see Risks.

### Feature identity (D3)

Each checkout is its own Project, so discovery finds each one's `docs/work/` and stamps
every feature with that checkout's id (`src/core/core.ts:293`); `features.items` holds one
record per (checkout, slug). The board collapses them:

- **Identity** is (repo group, slug); the renderer unions the copies' linked sessions
  and flags. Core is untouched.
- **Canonical** is the parent checkout's copy — its stage, card state and artifacts — so
  the board stays stable while agents write.
- **Divergence** shows as a chip when a worktree copy's stage differs ("also edited in
  `fix-auth`"), opening that copy.
- **Artifacts** open from the canonical checkout; a session **diff** still comes from
  the checkout it ran in. The feature is the repo's record; the diff is this session's work.

`Feature.projectId` stays the discovering checkout's id, so `sessionLink`
(`src/core/core.ts:718`), `LinkPicker.tsx:12`, `tree.ts:25,30` and `viewerFiles.ts:24-42`
are untouched — a worktree session links to the copy whose files it actually wrote.

### Lifecycle

`git worktree add -b <branch> <path>` under `~/.grove/worktrees/<repo>/<branch>`, with
branch conflicts probed by `git worktree list --porcelain` *before* `add` rather than by
reacting to git's raw `fatal`. A worktree is `git worktree lock`ed while a session runs
on it, so a stray `prune`/`gc` cannot remove it under a live agent. `git submodule update
--init --recursive` runs after creation (Q7). Removal is manual, or via a "clean up
merged" action (Q3).

## Program design

`grove new --worktree --branch <b>` → probe branch → `worktree add` → submodule update →
`lock` → `resolveProject` registers the worktree project with `worktreeOf` → the existing
`sessionCreate`, unchanged.

```
src/core/git.ts                                  MODIFIED  gitCommonDir(dir)
src/core/worktrees.ts                            NEW       add/list/remove/prune/lock
src/core/cliOps.ts                               MODIFIED  set worktreeOf on registration
src/shared/types.ts                              MODIFIED  Project.worktreeOf?
src/cli/{args,index}.ts, src/main/cliServer.ts   MODIFIED  --worktree --branch
src/renderer/src/{repoGroups,featureUnion}.ts    NEW       grouping + dedup selectors
src/renderer/src/{sessionList,tree,tags}.ts      MODIFIED  nesting, ordering, colour
src/renderer/src/components/{Sidebar,ProjectPage}.tsx  MODIFIED  nested rows
```

Nothing in `diff/`, `discovery/`, `autolink.ts` or `artifacts/` changes.

## One-way decisions

**W1. A worktree is its own lightweight `Project`; `Project.path` keeps its meaning.**
- Chosen because it is what the code already does given the approved disk location
  (`02-research.md` § *What the code already does with a worktree directory*); it is the
  only model needing no IPC change for a worktree session in the GUI
  (`src/shared/ipc.ts:15` carries no `cwd`); and it leaves no silent identity-mismatch
  path open. ADR 0037.
- **Rejected: plain `Session.cwd` under the existing project** — the previously approved
  answer. Needs `setRendered`, `resolveRoot`/watcher, `slugFor` and `runDiff` fixed, and
  gives the viewer no session-scoped root (`ui.viewer` is one global panel). Unreachable
  anyway while worktrees live outside the repo directory.
- **Rejected: `Project { checkouts[] }`.** Reopens ADR 0032, whose rejected option is
  exactly the root field it needs (`0032:41-42`); adds a second identity that can disagree
  with `projectId`, failing silently (draft-anchor collision at `core.ts:308`; wrong line
  numbers shipped to the agent at `comments/anchor.ts:83-84`); and cannot represent a
  monorepo subtree, which `git worktree add` cannot create.

**W2. Repo grouping is derived from git at load; `worktreeOf` is a nesting hint.**
- Rejected: `worktreeOf` authoritative — three ways to lie (parent removed, `projectAdd`
  on any folder, hand-edited config), each needing a startup integrity check and repair.
- Rejected: stored, validated against git, repaired — two sources of truth for one fact,
  and the repair writes to `config.json` at startup, which `core.ts:840` avoids on purpose.

**W3. A feature's canonical copy is the parent checkout's; a divergent copy shows a chip.**
- Rejected: primary wins silently — an agent's progress in a worktree is then invisible
  on the board, which is what this feature exists to surface.
- Rejected: newest write wins — the board flaps as agents write, nothing says which
  checkout a card describes, and "newest" is per-file, so a card can be assembled from two
  checkouts at once.

**W4. A sandboxed worktree session's mount set is decided by the sandbox feature, not
here.** ADR 0035 (D2 there).
- A worktree's `.git` is a *file* naming a path outside a mount of just the worktree:
  measured `fatal: not a git repository: (null)` for every git command, while grove's
  host side still shows a healthy card, branch and diff. The sandbox feature's D2 now
  carries the common-dir rule and the read-only carve-outs, so the combination is
  supported rather than refused.
- The obligation that remains is **verification, and it is not ours**: the sandbox
  feature must not ship a worktree mount path until slice 1 proves
  `git rev-parse --show-toplevel` and a real `git commit` work inside the mount.
- Rejected: deciding the mount set here — `src/core/sandbox/` does not exist and D2 is
  a one-way door of the other feature; leaving it implicit — that is how the sandbox
  design's incorrect row was written.

## Two-way decisions

| Decision | Choice |
|---|---|
| Entry point | CLI only: `grove new <kind> --worktree --branch <name>` (Q2/Q5) |
| Worktree path | `~/.grove/worktrees/<repo>/<branch>`, branch sanitized for separators (Q4) |
| Branch naming | `--branch` verbatim, no prefix (Q6) |
| Branch conflicts | Probed with `git worktree list --porcelain` before `add` |
| Locking | `git worktree lock` while a session runs on it |
| Submodules | `git submodule update --init --recursive` after creation (Q7) |
| Cleanup | Keep until merged or explicit removal (Q3) |
| Project name | `<repo> · <branch>`, so checkouts stay distinguishable where the list is flat |
| Sidebar default | Worktree rows collapsed under their parent |
| Worktree project page | **Sessions only.** The Features board is repo-scoped, so it lives on the parent checkout's page; ⌘B from a worktree session opens that page (`navigation.ts:62-69`). A worktree page showing only its own feature copies would contradict D3. |
| `projectRemove` on a parent | Refuse while a worktree child still has live sessions |
| Colour | `colorTags` indexes non-worktree projects only (`tags.ts:9,18`) |
| Comment headings | `comments/format.ts:44-46` gains the checkout name |
| Dead worktree projects | Pruned at start when `worktreeOf` is set and the path is gone |
| Hand-made worktrees | Not adopted in v1; added by hand, they are just projects |
| Sandboxed worktree | Supported by the sandbox feature's D2 (ADR 0035): the worktree **and** its repo's common dir, host-identical, `hooks/`+`config` read-only. That feature must not ship the path until slice 1 proves git works inside it (W4) |

## Risks

- **Dead worktree projects.** A worktree project whose directory is gone cannot be
  classified — no `.git` file to read — so it shows ungrouped until pruned. Mitigation is
  the prune rule above.
- **N watchers.** Two chokidar handles per checkout (`core.ts:257,264`), each `depth: 1`.
  Linear in worktree count, bounded by grove's own concurrency.
- **Colour dilution.** `colorTags` keys project colour on array index with 8 slots;
  mitigated by indexing non-worktree projects only.
- **Comment headings fork.** `comments/format.ts:44-46` keys the review message by
  `anchor.path` with no checkout qualifier, so two drafts on one relative path in different
  checkouts share a heading. Confusing, not corrupting.
- **A sandboxed worktree session, if W4 is not honoured.** Nothing here prevents it; the
  sandbox feature's slice 1 must.
- **Hand-made worktrees are never locked or cleaned up** — grove did not create them.

## Open questions

None.