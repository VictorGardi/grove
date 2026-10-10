---
feature: 2026-10-08-worktree-support
phase: structure
status: approved
version: 2
created: 2026-10-10
updated: 2026-10-10
approved_at: 2026-10-10
based_on:
  - 03-design.md@1
forced: []
---

# Worktree support — structure

> **v2, human-directed (2026-10-10).** Slice 3 gains one thing after a review of the whole
> repo for places that treat a checkout as a repo: the command palette lists every feature
> once per checkout, so 20 features across 2 checkouts are 40 entries, half of them duplicate
> labels. `paletteItems.ts` was in no slice. The human approved adding it to slice 3, which
> is why the structure stays `approved` rather than going back to draft — run
> `grove-approve 2026-10-08-worktree-support structure` if you want the formal stamp on top.
> Nothing else changed.

## Slices

### Slice 1 — Tracer: a worktree session, nested under its repo

- **Outcome:** `grove new claude --worktree --branch fix-auth` creates a `git
  worktree` under `~/.grove/worktrees/grove/`, starts a session there, and grove
  shows it nested and collapsed under `grove` in the sidebar and the Projects tab,
  with a correct branch, a diff scoped to the worktree, and the main checkout
  untouched. OpenCode behaves identically.
- **Files:** `src/core/git.ts`; `src/core/worktrees.ts` (NEW); `src/shared/types.ts`;
  `src/core/projects.ts`; `src/core/cliOps.ts`; `src/core/core.ts`;
  `src/cli/{args,index}.ts`; `src/main/cliServer.ts`;
  `src/renderer/src/repoGroups.ts` (NEW);
  `src/renderer/src/{sessionList,tree,tags,navigation}.ts`;
  `src/renderer/src/components/{Sidebar,SidebarRail}.tsx`.
- **Signatures:** `gitCommonDir(dir): string | null`; `worktrees.add(o)`;
  `worktrees.list(repo)`; `repoGroups(projects): RepoGroup[]`.
- **Verify:** `npm test` (`git.test`, `cliOps.test`, `sessionCreate.test`,
  `cli/args.test`, `cliServer.test`, `sessionList.test`, `tags.test`,
  `navigation.test`); `npm run typecheck`; manual in `npm run dev`:
  `grove new claude --worktree --branch probe`, then in the pane `pwd` is
  `~/.grove/worktrees/grove/probe` and `git rev-parse --show-toplevel` matches;
  grove's diff shows the agent's writes; the main checkout's `git status` is clean;
  the Projects tab shows `grove` with `probe` nested and collapsed; creating and
  destroying a worktree leaves other projects' colours and ⌘1-9 unchanged. Repeat
  with `grove new opencode --worktree --branch probe2`, and confirm the session
  **auto-links** to a feature after a write into `docs/work/<slug>/` — the one
  agent-dependent path, sourced differently per kind (OpenCode normalises HTTP
  events at `normalise.ts:118`; Claude reads the spool at `source.ts:46-48`).
- **Depends on:** none.

### Slice 2 — Lifecycle: conflicts, locking, pruning, removal

- **Outcome:** a branch already checked out elsewhere is refused *before*
  `git worktree add`; a worktree with a live session survives `prune`/`gc`;
  removing a project whose worktree has a live session refuses; a worktree project
  whose directory is gone is pruned at start; "clean up merged" removes worktrees
  whose branch is merged.
- **Files:** `src/core/worktrees.ts` (lock/unlock/prune/remove/merged);
  `src/core/core.ts` (`sessionCreate`, `sessionKill`, `sessionRemove`, `start`).
- **Signatures:** `worktrees.{lock,unlock,prune,remove,merged}`; `projectRemove`
  refuses while a worktree child has live sessions.
- **Verify:** `npm test` (`worktrees.test` against a real throwaway repo);
  `npm run typecheck`; manual: start two sessions on one branch and expect a clear
  refusal before `add`; run `git worktree prune` with a session live and expect the
  worktree to survive; `rm -rf` a worktree and restart grove and expect its row to be
  gone; ⌘W a session and expect its worktree to unlock.
- **Depends on:** 1.

### Slice 3 — One card per feature, with a divergence chip

- **Outcome:** the Features board shows one card per (repo, slug); a worktree copy at
  a different stage gets a chip that opens that copy; a worktree session's agent is a
  linked dot on the repo's card rather than on a duplicate; a worktree project page
  shows sessions only, and ⌘B from a worktree session opens the parent repo's page;
  the command palette offers one entry per feature rather than one per checkout.
- **Files:** `src/renderer/src/featureUnion.ts` (NEW); `Board.tsx`;
  `ProjectPage.tsx`; `SessionsBoard.tsx`; `FeaturePage.tsx`; `navigation.ts`;
  `src/renderer/src/paletteItems.ts`.
- **Signatures:** `unionFeatures(features, groups): Feature[]`;
  `divergentCopies(feature): Checkout[]`.
- **Verify:** `npm test` (`featureUnion.test`, `paletteItems.test`, Board and ProjectPage
  render tests); `npm run typecheck`; manual: edit a worktree's `02-research.md` frontmatter to a
  later stage and confirm a chip appears on the repo's card while the card's own
  stage does not move; click the chip and confirm the worktree's copy opens; confirm
  the worktree session's dot is on the repo's card and not on a duplicate; open the
  palette with two checkouts of one repo configured and confirm each feature is listed
  once.
- **Depends on:** 1.

### Slice 4 — Review comments stay unambiguous across checkouts

- **Outcome:** two drafts on the same relative path in two checkouts produce two
  distinctly labelled sections in the review message; a worktree session's review
  shows worktree-relative paths rather than `../../../..`.
- **Files:** `src/core/comments/format.ts`; `src/core/comments/anchor.ts`;
  `src/core/core.ts` (`reviewSend`).
- **Signatures:** `shownPath` gains a checkout label.
- **Verify:** `npm test` (`comments/format.test`, `anchor.test`);
  `npm run typecheck`; manual: draft on `docs/work/x/03-design.md` in both the main
  checkout and a worktree, send from each, and confirm two distinctly labelled `##`
  sections naming their checkout.
- **Depends on:** 3.

## Deferred

- A GUI worktree flow (palette or dialog) — Q2/Q5 keep v1 CLI-only.
- Adopting worktrees the human created by hand; grove never locks or cleans those up.
- `Session.extraRoots` and multi-repo sessions — rejected in the design, not deferred.
- Sandboxed worktree sessions — supported by ADR 0035's common-dir rule, which the
  sandboxing feature must verify before it ships that path.
- Sharing one `node_modules` across worktrees; pnpm's global store handles it and grove
  does not intervene.

## Rollout / migration

**No migration, in any persisted file.** `Project.worktreeOf?` is additive-optional, so
`ConfigFile.schemaVersion` stays 1 and `config.json` loads unchanged —
`readVersioned` returns parsed keys verbatim (`jsonFile.ts:31`), with
`Session.lastFocusedAt?` as the precedent. The state file is untouched: `Session` gains
no field, so the ADR 0029 `cwd` mechanism is not reused and no version bump is needed.

A session started with `--cwd <worktree>` today already resolves to its own Project —
`resolveProject` matches by path containment and falls back to
`git rev-parse --show-toplevel` (`cliOps.ts:37,53-54`, `core.ts:156-163`) — so slice 1
gives existing setups their nesting without changing any stored data.

No downgrade hazard: an older grove build reads the same `config.json`, ignores the
unknown `worktreeOf` key, and shows worktrees as ordinary top-level projects.

## Open questions

None.