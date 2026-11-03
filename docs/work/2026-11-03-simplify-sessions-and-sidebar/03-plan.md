---
feature: 2026-11-03-simplify-sessions-and-sidebar
phase: plan
status: approved
version: 8
created: 2026-11-03
updated: 2026-11-03
approved_at: 2026-11-03
based_on: [01-outcome.md@2, 02-research.md@1]
forced: []
---

# Plan: Simplify sessions and sidebar

## Decisions

### D1. How a session's link to another session gets its kind

**Context.** Today `Session.parentId` is the only link, and the code branches on it for several unrelated things. The brief wants every link to be one of: ad-hoc group member, auto-run slice, or agent subagent. Agent subagents are never sessions, so only two kinds are stored.

**Options.**
- A. Add one optional persisted field `relation: 'group' | 'slice'` next to `parentId`. Missing means `group`. A new CLI flag `grove new --relation slice` (valid only with `--child` or `--parent`) sets `slice`; `grove-run` passes it for each slice session, and every other creation sets `group`. `--link` is not used to tell them apart, because an ad-hoc child can use it too. Pros: additive, no migration step, old data keeps working. Cons: two fields describe one link, and one new CLI flag.
- B. Replace `parentId` with a typed link object `{ id, kind }` (`kind: 'group' | 'slice'`) and migrate saved state to schema v11. The step is a pure, lossless map: every `parentId: X` becomes `link: { id: X, kind: 'group' }`, nothing is dropped. A new CLI flag `grove new --relation slice` (valid only with `--child` or `--parent`) sets `slice`, and `grove-run` passes it. Pros: one field, so a link cannot exist without a kind. Cons: a state migration (an older Grove build cannot read a v11 file), and every reader of `parentId` changes in one slice.

**Pick:** B

**Human pick:** B (the human vetoed A in the review).

**Outcome impact.** Old children load as group members (`kind: 'group'`) and stay hidden and promotable; nothing in the saved state is deleted, only reshaped. `grove list` keeps printing the parent id and adds the kind. The agent-subagent kind stays inside status folding, as it does now, and is named in `CONTEXT.md` so "parent" stops meaning three things.

### D2. What happens to `grove escalate` when the hold goes

**Context.** `grove escalate` exists only to end the 60-second hold early. Without the hold it has no effect. The grove and grove-run skills tell agents to call it.

**Options.**
- A. Remove the command, the IPC path (`sessionEscalate`) and every skill sentence that mentions it. An old agent that still calls it gets an "unknown command" error.
- B. Keep the command as a harmless no-op that prints "no longer needed". Pros: old skills do not break. Cons: dead surface, and the brief says nothing in the app should mention it.

**Pick:** A

**Outcome impact.** Nothing in the app mentions `grove escalate`. Agents on the old skill text see an error once; the skill text is updated in the same slice.

### D3. What "promote" does to the link

**Context.** The brief says promote turns a hidden child into a normal sidebar session. The slice progress bar and the "via parent" row both need the parent link to survive.

**Options.**
- A. Promote clears `parentId`. Pros: simplest, reuses "Clear parent". Cons: the link, the progress count and jump chips are lost.
- B. Promote sets a persisted `promoted: true` flag. The session shows as its own sidebar row and keeps its parent link for progress and jump chips. Pros: nothing is lost, and unpromote is a flag flip. Cons: one more field.

**Pick:** B

**Outcome impact.** A promoted child appears in the sidebar under its project like any session. The parent's slice count still includes it.

### D4. How far the epic removal goes

**Context.** Two separate things carry the word "epic". The app reads generic `group` and `parent_field` settings from `workflow.yaml`. The `kind: epic` rules live in `resources/skills/grove-run/references/contract.md` and `gates.md`, in `AGENTS.md`, and in `grove.config.json` limits. Those skill references are copies synced from the grove workflow tooling, which lives outside this repo.

**Options.**
- A. Remove the epic concept from the app only: `group` and `parent_field` parsing, group completion, FeaturePage Parent/Children, board tags, the CONTEXT.md "Group feature" term, ADR notes. Leave the skill references, `AGENTS.md` and config limits untouched, and say so.
- B. Also edit the synced skill references, `AGENTS.md` and `grove.config.json`. Pros: nothing says "epic" anywhere. Cons: the next sync from the tooling repo brings it back, and `AGENTS.md` governs how this very workflow runs.

**Pick:** B

**Human pick:** B (the human vetoed A in the review).

**Outcome impact.** The app no longer knows epics, and neither do the skill references, `AGENTS.md` or the config limits in this repo. The synced skill references (`resources/skills/grove-run/references/contract.md` and `gates.md`) say "do not edit the copies directly", so the same edit has to be made in the grove workflow tooling that syncs them, or the next sync brings the epic text back (see Risks). The parser keeps tolerating and ignoring `group` and `parent_field` in a workflow file (the bundled one and any `config.json` override), so an existing custom workflow file still loads. The bundled `resources/workflow.yaml` drops its `epic` kind entry and `parent_field`; a feature whose `feature.md` says `kind: epic` then loads as an ordinary feature.

### D5. What deleting the boards leaves behind

**Context.** The artifacts board is the only list of artifacts, `ArtifactPage` and `FeaturePage` are reached through boards, and `ArtifactPage` imports helpers from board code.

**Options.**
- A. Delete all three boards. Keep `FeaturePage` and `ArtifactPage`, moving the shared helpers they use out of board files. Add feature and artifact entries to cmd+K, from the feature data the app already derives per project.
- B. Delete the features and sessions boards only, and keep the artifacts board. Pros: smaller change, artifacts stay browsable. Cons: it contradicts "no board or list page" in the brief.

**Pick:** A

**Outcome impact.** Features and artifacts are reached from a linked session or by name in cmd+K. The project page becomes the minimal page.

### D6. How the run pauses for the mockup pick

**Context.** The brief wants 3-5 concepts for all five hide-children pieces, and the run waits for the human's pick before building them. `grove-run` is unattended after slice 1.

**Options.**
- A. A dedicated slice whose only job is to publish the mockup artifact and stop. The run halts with a recorded reason; the human tells the run which concept won; the next slice builds it.
- B. Fold the mockups into the build slice and ask during it. Pros: fewer slices. Cons: a build slice that waits on a human defeats the unattended run.

**Pick:** A

**Outcome impact.** The run stops once, at a known place, with the artifact link in the run log. Nothing about the hide-children UI is built before the pick. The stop uses grove-run's existing halt protocol: a commit with subject `<slug>: slice 6 halted` and a `SLICE 6: halted` report. The human replies by running `grove-run <slug> --continue` after writing the pick into `04-run.md`.

### D7. Who answers a child's prompt once the hold is gone

**Context.** The grove-run skill is built on the hold: while a child waits on a permission or question, the parent has 60 seconds to answer it (`grove wait` exits with code 4, the parent answers with `grove send`), and otherwise escalates. With no hold, a parent that still answers would race the human. The brief says a child's prompt reaches the human at once, and does not say what the parent does.

**Options.**
- A. The parent never answers a child's prompt. The human does. `grove wait` treats a waiting child as still running (no exit code 4; the usage text, `src/cli/index.ts` output and `output.test.ts` change with it), and the `from` field that `grove send` fills from `GROVE_SESSION_ID` (the hold bookkeeping) is removed along with its handler code; plain `grove send` for ordinary messages stays. Pros: one clear owner, matches "reaches me immediately". Cons: an unattended run stops making progress on a child that asks something routine until the human answers.
- B. Keep the parent's ability to answer, and accept that the first writer wins. `grove wait` still exits 4 when a child asks. Pros: a parent can still handle routine prompts. Cons: it is the race the hold existed to prevent, and the human sees a prompt vanish.

**Pick:** A

**Outcome impact.** An unattended run waits on you when a child asks for permission or has a question. Nothing is answered on your behalf.

## Slices

### Slice 1. Zones and Group by are gone: one fixed sidebar layout

**Outcome.** The sidebar is Project, then root sessions, with one sort control. The Zones toggle, zone sections, the zone menu items, Group by and Workflow-status grouping are gone, and the keyboard shortcuts follow the visible list.
**Thin end-to-end:** Sidebar UI (toggle and Group by menu removed) -> shared types (`Zone`, `zoneOverride`, `sidebarView`, `groupBy`) -> core (`withZones`, `sessionSetZone`, IPC channel and handler) -> `grove list` output. Deliberately missing: boards, epic, the hold, the typed link, hiding children.
**Files.** `src/shared/zones.ts` (+test), `src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/cli.ts`, `src/core/core.ts`, `src/main/ipc.ts`, `src/main/cliServer.ts`, `src/renderer/src/zoneList.ts` (+test; the kept helpers `rowTitle` and `rowLine` move to a new `rowText.ts` and `zoneList.ts` is deleted, so no file is named after zones), `src/renderer/src/components/ZoneSection.tsx` and CSS, `src/renderer/src/components/Sidebar.tsx` and CSS, `src/renderer/src/sessionList.ts` (+test), `src/renderer/src/stores/slices.ts`, `src/core/sessions.test.ts`, `src/renderer/src/sessionStatus.test.ts`. Dragging a session onto a workflow-status group goes away with Workflow-status grouping. The one sort control keeps Custom order, which drag-to-reorder needs.
**Verification.** `npm run typecheck`, `npm test` and `npm run build` pass. `grep -rIni "zone" src` returns only a comment naming the dead keys `zoneOverride` and `sidebarView`. A test loads a saved state and a `ui.json` that still contain `zoneOverride`, `sidebarView`, `groupBy`, `board` and `artifacts` and shows they load without error and are preserved on save. `sessionList.test.ts` covers project grouping, sort, and Custom-order drag reorder. Launch with `npm run dev`: the sidebar has no Zones|Projects toggle and no Group by menu, there is one sort control, and cmd+1..9 and cmd+. move through the rows top to bottom. Note: `held` and `handled` stay live but unrendered until slice 5.

### Slice 2. Typed session link, relation kind and the promote flag

**Outcome.** Every session link is a group member or an auto-run slice, any child can be flagged as promoted, and saved state moves to the new shape without losing anything. Old data loads as group members.
**Files.** The work has two steps in this order. Step one is mechanical: replace `Session.parentId` in `src/shared/types.ts` with `link?: { id: string; kind: 'group' | 'slice' }`, add the schema v11 step `v10ToV11` in `src/core/store/stateStore.ts` (+test), and rewrite every reader and writer of `Session.parentId`: `src/shared/sessionGroups.ts` (+test; `orphanChildren` clears `link` and `promoted` when a parent is removed), `src/shared/attention.ts`, `src/shared/cli.ts`, `src/renderer/src/sessionList.ts`, `family.ts`, `parentOptions.ts`, `components/Sidebar.tsx`, `components/SessionMeta.tsx`, `components/ParentPicker.tsx`, `src/core/core.ts` (creation path, `sessionSetParent`, the notification and send paths that read it), `src/main/cliServer.ts` (`grove list` keeps printing `parent` and adds `relation`), and every test fixture that builds a session with `parentId` (about 16 of the 19 files that mention it; do not touch the three agent-event tests `src/core/status.test.ts`, `src/core/copilot/events.test.ts` and `src/core/opencode/normalise.test.ts`, whose `parentId` is the agent-event field, and leave the `oc.emit({ type: 'child', ..., parentId })` event fixtures in `sessions.test.ts` and `features.test.ts` as they are; the real session assertions at `sessions.test.ts:280-301` change). The compiler points at any remaining reader; `src/shared/cli.ts`, `parentOptions.ts` and `SessionMeta.tsx` change only where they touch the link type. The schema bump also changes the hard-coded version 10 in the `readVersioned` call and in the default state, adds `10: v10ToV11` to the migrations map in `stateStore.ts`, and puts the one-time backup copy in `src/core/store/jsonFile.ts`. Step two adds the new behaviour: the `--relation slice` flag in `src/cli/args.ts` and `src/shared/cli.ts` (valid only with `--child` or `--parent`), `promoted` on `Session`, `sessionPromote` in `src/core/core.ts`, the `session:promote` channel in `src/shared/ipc.ts` and `src/main/ipc.ts`, `resources/skills/grove-run/SKILL.md` (passes `--relation slice` for each slice session), `CONTEXT.md`, and `docs/adr/` (a new ADR superseding 0042's "grouping only" wording). `session:setParent` gives a re-parented session `kind: 'group'`; clearing a parent removes `link`. The loader copies `state.json` to `state.v10.bak` once before the first v11 write.
**Verification.** `npm test`, `npm run typecheck` pass. `grep -rIn "parentId" src --exclude-dir=agents --exclude-dir=opencode --exclude-dir=copilot --exclude=status.ts --exclude=status.test.ts` returns only the migration step, its test, and the two agent-event fixtures `oc.emit({ type: 'child', ..., parentId })` in `sessions.test.ts` and `features.test.ts` (the agent-event field is a different thing). `stateStore.test.ts` loads a v10 state where one session has `parentId: 'x'` and returns `link: { id: 'x', kind: 'group' }` for it, drops nothing else, loads a v10 state with no `parentId` with no `link`, and shows `state.v10.bak` exists afterwards. A v11 save-and-load round trip keeps `link` and `promoted`. `sessionCreate.test.ts` shows `grove new --child --relation slice` persists `link.kind: 'slice'`, and that an ad-hoc `--child --link <slug>` without the flag gets `'group'`. `args.test.ts` rejects `--relation` without `--child` or `--parent`. `sessionGroups.test.ts` shows that removing a parent leaves a `promoted` child as a plain root with `link` and `promoted` cleared, and that re-parenting gives `'group'`. `cliServer.test.ts` shows `grove list` still prints `parent`. `grep -rn "relation" resources/skills` hits `grove-run/SKILL.md` only. `CONTEXT.md` also states that a worktree's "parent checkout" (`Project.worktreeOf`) is a separate thing from a session's link, so "parent" no longer covers both.

### Slice 3. Boards removed, minimal project page, features and artifacts in cmd+K

**Outcome.** No boards exist. Clicking a project or worktree shows the minimal page. cmd+K finds any feature or artifact by name.
**Files.** Delete the board components: `Board.tsx`, `SessionsBoard.tsx`, `ArtifactsBoard.tsx`, `ArtifactCard.tsx`, `shell/BoardSwitch.tsx`, and `tree.ts` board parts (`boardColumns`, `sessionColumns`). Rewrite `ProjectPage.tsx` and CSS as the minimal page. Keep the helpers the pages and cmd+K need: `featureUnion.ts` (`unionFeatures`, feeds the feature entries in cmd+K) stays as is, and `artifactsBoard.ts` is split so `artifactClusters`, `openCard`, `artifactCrumbs`, `commentCard` and `stepKey` move to a new `artifactData.ts` (feeds the artifact entries in cmd+K and `ArtifactPage`); `ArtifactPage.tsx`, `App.tsx` and `stores/slices.ts` import from the new file. Also change `tags.ts`, `navigation.ts`, `stores/slices.ts`, `App.tsx`, `paletteItems.ts`, `src/main/menu.ts`, `src/shared/ipc.ts`, `src/shared/types.ts` (the `board` and `artifacts` keys, plus `ArtifactsView`, `CanvasView`, `ArtifactRef` where nothing else uses them, and `DEFAULT_UI`'s `board: 'sessions'`), `README.md`, `CONTEXT.md` ("Board"), related tests.
**Verification.** `npm test`, `npm run typecheck`, `npm run build` pass. In `npm run dev`: the menu has no Project Board or Artifacts entry, a project click shows the header, "new session" and the cmd+K hint, and cmd+K finds a known feature and a known artifact by name and opens its page. `paletteItems.test.ts` covers the new entries. From a session linked to a feature, the linked-feature tag still opens `FeaturePage`, and an artifact link still opens `ArtifactPage`.

### Slice 4. Epic concept removed from the app

**Outcome.** The app has no epic or group feature behaviour.
**Files.** `src/core/workflow/parse.ts` (keeps tolerating and ignoring `group` and `parent_field`), `derive.ts` and tests, `resources/workflow.yaml` (drops the `epic` kind entry and `parent_field`), `src/shared/types.ts` (`Feature.group`, `parent`), `FeaturePage.tsx`, `src/renderer/src/App.tsx` (the `parent` and `children` props at l.231-232), `navigation.ts` and `navigation.test.ts` (`childrenOf`), `CONTEXT.md` ("Group feature"), `docs/adr/` (a new ADR superseding the group parts of 0002 and 0018). Per D4 B the epic text also goes from `resources/skills/grove-run/references/contract.md` and `gates.md` (epic folders, `kind: epic`, `children:`, `appetite`, `order`, inheritance, the epic gate, targeted stale marking), from `AGENTS.md` (the "Epics" gate line) and from `grove.config.json` (`epicMaxOneWayDecisions`, `epicMaxChildren`).
**Verification.** `npm test`, `npm run typecheck` pass. `grep -rIni "epic" src resources AGENTS.md grove.config.json CONTEXT.md README.md` returns nothing except one comment where the parser tolerates old `group` and `parent_field` keys (ADRs deliberately keep the history). `grep -rIn "childrenOf" src` returns nothing, and the bundled `resources/workflow.yaml` has no `group:` or `parent_field`. A parse test loads a workflow file that still contains `group: true` and `parent_field: parent` and succeeds. A derive test loads a feature whose `feature.md` says `kind: epic` and returns it as an ordinary feature.

### Slice 5. The child-prompt hold is removed

**Outcome.** A child's permission request or question reaches the human at once. `grove escalate` and its text are gone.
**Files.** `src/core/core.ts` (`startHold`, `settleHold`, `escalateAfterSec`, `sessionEscalate`, `holdSent`, the `target.parentId === a.from` check now reading `link`, the `notified` escalation logic), `src/shared/types.ts` (`held`, `handled`, `attention`, and `escalateAfterSec` in `ConfigFile`), `src/shared/attention.ts` (`asksHuman` is simplified, not removed), `src/shared/cli.ts` (the `sessions.escalate` entry), `src/main/index.ts` (the `s.attention?.reason` read for the notification), `src/main/cliServer.ts`, `src/cli/*` (usage text, `index.ts`, `args.ts`, `args.test.ts`, `output.test.ts`; the `from` payload of `grove send` per D7), `src/main/cliServer.test.ts`, `src/core/workflow/derive.ts` and `src/renderer/src/sessionStatus.ts` (callers of `asksHuman`), `resources/skills/grove/SKILL.md` (the whole "Answering a child's prompt" section and the "recorded on your card as handled" text are rewritten or deleted), `resources/skills/grove-run/SKILL.md` (the "child's prompt" flow, `grove wait` exit 4 and the silence wording are rewritten per D7), `README.md`, `CONTEXT.md`, `docs/adr/` (a new ADR superseding the hold parts of the attention-ownership work), related tests. An old `config.json` that still has `escalateAfterSec` is ignored and preserved when the config is saved.
**Verification.** `npm test`, `npm run typecheck` pass. `grep -rIn "grove escalate\|sessionEscalate\|startHold\|settleHold\|escalateAfterSec\|holdSent" src resources README.md CONTEXT.md AGENTS.md` returns nothing except the dead-key comment (ADRs deliberately keep the history), `grep -rIn "\bheld\b\|\bhandled\b" src` returns nothing except dead-key comments (a leftover read of `held` or `handled` would otherwise survive; reword the unrelated "escalated" test titles in `sessions.test.ts` if they trip it), and `grep -rIn "grace\|handled\|Grove holds" resources/skills` returns nothing. A test in `sessions.test.ts` asserts that a child entering permission raises its notification in the same tick, and that `asksHuman` is true for a plain waiting session. A test asserts a config file with `escalateAfterSec` survives a save unchanged.

### Slice 6. Mockup round: the run stops for the human's pick

**Outcome.** The human can open 3-5 mockup concepts for the badge, the via-parent row, the peek overlay, promote and the slice progress bar, in a Claude artifact. The run halts until the human picks.
**Files.** One HTML mockup page in the run worktree's scratch area (published as an artifact, not committed to `src`); `04-run.md` records the artifact link, the halt reason, and later the pick.
**Verification.** `grep -n "claude.ai/artifact" 04-run.md` shows the artifact link, and the page shows between 3 and 5 concepts, each drawn for all five pieces. Before publishing, the slice reads `slice-mode.md` and confirms a deliberate halt with `--continue` and a recorded pick is accepted; if not, it stops and tells the human. `git log -1 --format=%s` on the run branch is `<slug>: slice 6 halted` and the run report says `SLICE 6: halted`. After the human writes `Mockup pick: <concept>` into `04-run.md` and runs `grove-run <slug> --continue`, slice 7 starts only if `grep -n "Mockup pick:" 04-run.md` matches.

### Slice 7. Hide-children UI, built from the picked concept

**Outcome.** Children are hidden behind their parent. The parent shows its badge and slice progress. A waiting child shows as one "via parent" row. Peek and promote work.
**Files.** `src/renderer/src/components/Sidebar.tsx` and CSS, `src/renderer/src/sessionList.ts` (+test; its `isChild` logic treats a `promoted` child as a root, and "needs you" for the badge and the via-parent row is the child's own `asksHuman`), `src/renderer/src/family.ts` (+test; the slice count still comes from the parent's `progress`, set by `grove progress`, as today, and the link kind only labels a child as slice or group in the peek overlay), `SessionMeta.tsx`, `ChildrenPopover.tsx` (reused or replaced by the peek overlay), a new peek overlay component and CSS, `src/renderer/src/App.tsx` (`overlayOpen`), and the existing session-read IPC channel (`session:read`, exposed to the renderer through `window.api.invoke`; slice 7 confirms the exact channel when it plans the slice).
**Verification.** `npm test`, `npm run typecheck`, `npm run build` pass. `sessionList.test.ts` asserts a parent with 2 running and 3 done children renders one row, that a promoted child renders as its own row, and (a pure function for the badge and via-parent selection) that a waiting child yields exactly one via-parent row, an answered child yields none, and no child appears twice. In `npm run dev` with a grove-run parent: no child cards in the sidebar, a "3 of 5" style progress bar on the parent, a waiting child shows once as a "via parent" row that disappears when answered, peek shows a live screen, and promote moves a child into the project list, and cmd+1..9 still follow the visible rows once children are hidden and a via-parent row is showing. If this slice overruns, the peek overlay's live screen is cut first (it falls back to status only), then the slice progress bar's styling; both are finished in a follow-up.

## Reviewer round log

- Round 1 (5 blocking, 13 non-blocking). Blocking: slice 3 deleted `featureUnion.ts` and `artifactsBoard.ts` that cmd+K needs → fixed by keeping `featureUnion.ts` and moving the artifact helpers to `artifactData.ts`; slice 4 would reject old workflow files that still have `group` and `parent_field` → fixed by keeping the parser tolerant, with a parse test; slice 5 left the parent's behaviour on child prompts undecided and missed dependents → fixed by adding D7, the files and an `asksHuman` test; the plan had no way to tell a slice link from a group link → fixed by a `--relation slice` flag in D1; the mockup slice verification was not checkable → fixed by tying it to grove-run's halt commit, the artifact link and a `Mockup pick:` line in `04-run.md`.
- Round 2 (0 blocking, 12 non-blocking). Applied: `--from` is an IPC `from` field not a CLI flag, exit 4 text and `output.test.ts`, `cliServer.test.ts`, the whole grove skill section and extra greps, `--relation` rules and a `promoted` orphan test, `types.ts` artifact types and `DEFAULT_UI`, case-insensitive zone grep, a second cut for the UI slice, and risks for the exit 4 timeout and the skill read at spawn.
- CTO check (0 blocking). Noted, not blocking: if the UI slice's overrun fallback is used, peek shows status only until a follow-up; a child whose pane is gone also shows status only. An unattended run now waits on the human for any child question (D7).
- Veto: D1. The human replaced the additive `relation` field (A) with a typed `link` and a schema v11 migration (B).
- Veto: D4. The human replaced "app only" (A) with removing the epic concept from the skill references, `AGENTS.md` and the config limits too (B); slice 4 and the risks are updated. D5, D6 and D7 were kept.
- CTO check after the D4 veto and brief v2 (0 blocking). Applied the notes: the overrun fallback and the subagent reading are listed under Deviations, slice 3 checks the linked-session route, slice 6 caps concepts at 5, slice 7 re-checks cmd+1..9.
- Re-review after the D1 veto (4 blocking, 9 non-blocking). Blocking: the `parentId` grep could never pass because the agent-event field shares the name → fixed by scoping the grep to exclude the agent-event files; slice 6 omitted `ParentPicker.tsx` and `src/shared/cli.ts` → fixed by adding them; 19 test fixtures use `parentId` → fixed by listing them and the command that finds them; the link change was too large and slices 1-5 would have been rewritten by it → fixed by merging the old slices 1 and 2 into one sidebar slice and moving the typed link to slice 2, ahead of the hold and attention work, with a mechanical rename first and new behaviour second (7 slices). Applied non-blocking: `state.v10.bak` backup and test, re-parent gives `group`, v11 round-trip test, `session:promote` channel, downgrade wording, old slice sessions noted below.

- Round 3 (3 blocking, 11 non-blocking; last allowed round). Blocking: the slice 2 `parentId` grep also hits two agent-event fixtures → fixed by naming them as expected residue; the slice 2 fixture list would have let an implementer rewrite three agent-event tests → fixed by naming them as off limits; the slice 5 `escalate` grep matches unrelated "escalated" words → fixed by a tighter grep plus a `held`/`handled` grep. Applied non-blocking: schema bump mechanics and `jsonFile.ts`, the precise reader list, `zoneList.ts` deleted with its helpers moved to `rowText.ts`, a `relation` grep for the skills, the worktree "parent checkout" wording, and slice 6's pre-check inside its verification. Not applied: splitting slice 7 (the 8-slice limit allows it; left as one slice with a named overrun fallback), and the churn in `Sidebar.tsx` and `sessionList.ts` across slices 1, 2 and 7 is accepted.

## Deviations from the brief the human should know

- The mockup round sits at slice 6, after the removals and the data change, so the unattended cleanup finishes before the run stops for the pick.
- `Session.parentId` is replaced by a typed `link` and saved state moves to schema v11 (D1, the human's pick). The migration only reshapes data and keeps a one-time backup, so the brief's "nothing deleted" holds.
- Slice sessions from runs that already happened migrate as group members, because the old data has no kind. Their slice count in the sidebar is unaffected, since it comes from the parent's `progress`.
- Slices 1-5 and the old slice 2 (layout) are now one slice, so the plan has 7 slices.
- If the overrun fallback in slice 7 fires, peek shows status only and the progress bar is unstyled until a follow-up, which is less than the brief's "live screen". A child whose pane is gone also shows status only.
- A subagent is not a stored session link (subagents are never sessions). It is named in `CONTEXT.md` and stays inside status folding; the stored kinds are group and slice.
- The brief says "No change to ... the grove workflow phases". Removing the epic text from the skill references and `AGENTS.md` (D4 B) changes the workflow's rules for epics only; no phase of the normal flow changes.

## Risks and what is deliberately not done

- Removing the hold reverses part of the attention-ownership work merged in PR #10. Slice 5 supersedes its ADR; the held/handled behaviour is not kept anywhere.
- An older Grove build cannot read a v11 state file: it renames the file to `state.json.bad-<timestamp>` and starts with no sessions, which looks like data loss. Recovery is to rename that file back, or restore `state.v10.bak`.
- With exit 4 gone (D7), an unattended `grove-run` blocks on a waiting child until its `--timeout` expires and then reports that child as waiting on the human.
- Slices 2 and 5 edit `resources/skills/grove-run/SKILL.md`, which the running slice children read from the repo at spawn time, so later slices follow the new text. Slice 6's deliberate halt reuses the failure-halt protocol; the slice checks `slice-mode.md` first and, if a halted report plus `--continue` with a recorded pick is not accepted, stops and tells the human instead of improvising.
- The synced skill references `contract.md` and `gates.md` say "do not edit the copies directly" (they are copied by `scripts/sync-shared.sh` from the grove workflow tooling, outside this repo). Slice 4 edits them here as the human chose (D4 B); unless the tooling's source gets the same edit, the next sync restores the epic text. The slice also removes the "Epics" gate line from `AGENTS.md`, which governs how this workflow runs, and the epic limits from `grove.config.json`; skills that still check those limits (for example `grove-epic-status`, which is not in this repo) must be updated outside it.
- `ui.json` and state files keep dead keys (`sidebarView`, `board`, `artifacts`, `zoneOverride`, `groupBy`). How `ui:set` treats unknown keys was not verified in research, so slice 1 verifies it with a test.
- The peek overlay depends on `grove read`-style capture of a child's screen; a child whose pane is gone shows its last status only.
- Slice 2 is large (one type change, a migration, about a dozen source files and 19 test files). It is mechanical first and behavioural second, so it can be reviewed as a rename plus a small feature.
- Not done on purpose: decision queue, chief of staff, goal cards, any feature list or inbox, per-parent expander, any destructive data migration.

## Open questions
