Status: ready-for-agent

# The window store

## Problem Statement

The window's rules about spaces, tabs and agents live inside one 1,700-line entry file with no exports, mixed in with DOM painting, dialogs, config and appearance wiring. As a maintainer, I cannot change how the window restores its **Active tab**, merges an agent's status, renumbers **Tab numbers** or reconciles with **Core** without running the whole window under a DOM and a faked Tauri layer. Only a few of those rules are covered, and only through the DOM: restoring the grid and active tab on startup, opening a tab from the CLI, the opened-before-reply race, typed agent tabs, and the unknown-state hint. Not covered at all: the **Recent order** restore, carrying `resumable` and context over a status change, **Exited tab** handling and the refused state during reconciliation, removing a space or its last tab, and renumbering after a close. The mapping from the core's `terminal` kind to the window's `shell` kind is also repeated in three places.

## Solution

Pull the window's tab, space and agent state, and its reconciliation with **Core**, into one deep module, the window store, with a small interface. It has no DOM and no Tauri, so every rule can be tested in plain vitest. The entry file keeps only painting, I/O and wiring: it forwards core events to the store, runs the effects the store asks for, and repaints on each change. The user sees no change in behaviour.

## User Stories

1. As a maintainer, I want the window's tab and agent rules in a module with no DOM, so that I can test them in plain vitest.
2. As a maintainer, I want one place that turns a core tab record into the window's kind, so that the `terminal` to `shell` mapping exists once.
3. As a maintainer, I want adding a tab to be idempotent by id, so that a tab-opened notification arriving before the open call's reply never creates a duplicate.
4. As a maintainer, I want tabs addressed only by their real id, so that no placeholder id or "is this tab adopted yet" guard exists.
5. As a human, I want my **Active tab** and **Active space** restored when the window starts, so that I land where I left off.
6. As a human, I want each space's **Recent order** restored on start, so that the previous-tab key still works after a restart.
7. As a human, I want the grid, its custom layout and the tabs in it restored when they still exist, so that a restart does not undo my arrangement.
8. As a human, I want a saved grid tab that no longer exists to be dropped silently, so that startup never fails on stale state.
9. As a human, I want the grid to turn itself off when it holds no tabs or the **Active tab** is not one of its panes, so that I never focus a tab the grid does not show.
10. As a human, I want focusing a tab in another space to switch the **Active space**, so that the strip and sidebar agree.
11. As a human, I want a space with no recent tab to show its first tab, and an empty space to show nothing, so that selecting a space always lands somewhere sensible.
12. As a human, I want selecting a space while the grid shows to focus that space's grid pane, so that the grid stays up.
13. As a human, I want closing the **Active tab** to show the space's next tab, so that I am not left on a blank screen.
14. As a human, I want **Tab numbers** to stay the position among my space's tabs and renumber when an earlier tab closes, so that "Tab N" matches what I see (kept as today; not a new decision).
15. As a human, I want an unnamed tab to show as "Tab N" and a named tab to show its name, so that tabs are always identifiable.
16. As a human, I want an agent's status change to update its tab, row and space tile at once, so that I never see a stale state.
17. As a human, I want a status change to keep the agent's `resumable` flag and context reading from its previous entry, so that the Resume button and context ring do not flicker away.
18. As a human, I want a context reading for a tab with no agent entry yet to be ignored until its first status arrives, so that a reading never creates a phantom row.
19. As a human, I want an agent I type by hand into a shell tab to turn that tab into an agent tab, and turn it back to a shell when the agent ends, so that the tab shows what is really running.
20. As a human, I want a launched agent tab to keep its agent kind after the agent ends, so that only tabs the window itself changed are turned back.
21. As a human, I want a resync with the core to keep a detected kind, so that a reconnect does not flip an agent tab back to a shell.
22. As a human, I want tabs whose process is gone after a reconnect marked as **Exited tabs**, so that I see `[process exited]` and the Resume offer.
23. As a human, I want a tab that re-attaches successfully to stop being an **Exited tab**, so that a resumed agent tab shows as live.
24. As a human, I want the window to refuse to mark tabs exited when the core refused to load its state, so that a bad state file does not make live tabs look dead.
25. As a human, I want the refused reason shown and new-tab actions disabled while the state file is refused, so that I cannot act on state the core did not load.
26. As a human, I want removing a space to remove its tabs, agent rows and **Recent order**, and to select the first remaining space if it was active, so that nothing dangles.
27. As a human, I want the last tab of a space closing to ask whether to remove the space, so that an empty space is a deliberate choice.
28. As a human, I want a space added or changed elsewhere (CLI, another window) to appear in the sidebar immediately, so that all views agree.
29. As a human, I want a tab opened from the CLI to appear without changing my active grid, so that automation does not disturb my layout.
30. As a human, I want the window's view state saved after every change, so that a crash or reload restores the latest state.
31. As a maintainer, I want view-state persistence behind a port, so that tests use an in-memory store and demo mode uses a no-op.
32. As a maintainer, I want the states demo page driven through the same store, so that it renders through the same rules as the real window.
33. As a maintainer, I want the store to return the previous agent state from a status change, so that the entry file can still decide whether the change settled.
34. As a maintainer, I want reconciliation to return plain effects (tabs to attach, tabs exited with their exit code), so that the store never awaits I/O.
35. As a maintainer, I want the entry file to build and drop its DOM record per tab from one change loop, so that startup, demo and every core event take the same path.
36. As a maintainer, I want the existing DOM acceptance test unchanged and green after every slice, so that I know the store is still wired to the screen.
37. As an agent working in this repo, I want the store's rules named after glossary terms, so that tests and code read in the project's language.

## Implementation Decisions

- **Module:** a window store, with no DOM, Tauri or bridge dependency. It owns spaces, tabs and their order, agents, the **Active tab** and **Active space**, **Recent order** per space and for the whole window, grid on/off, grid layout and last grid focus, the refused state, whether view state has been restored, the set of tabs whose kind was detected from their agent, and per-tab grid membership, exited flag and **Tab number**.
- **Not owned:** core connection status, the last focus report, config (keys, theme tokens, notes), sound, window focus, demo flag, home folder, and the per-tab line-change counts (an async diff-driven paint cache).
- **Tab record:** the store holds a model-only tab (id, space id, space path, kind, label, number, grid membership, exited). The entry file keeps a separate DOM record per tab (pane, header, host, strip button, pill, terminal view, attach state and output queue) keyed by id. Everything in the store is addressed by id, including **Recent order**.
- **Construction:** created with a view-state port and a single change subscriber.
- **Writes:** add tab (idempotent, takes the wire record, applies the one kind mapping), mark exited, mark alive, remove tab, activate tab, select space (with an optional chosen tab), toggle the **Active tab** in the grid, set grid on/off, set grid layout, upsert space, drop space, set agents (replace the list), apply status change (returns the previous state), apply context, and reconcile (takes the core's spaces-and-tabs result, returns the tabs to attach and the tabs marked exited with their exit codes).
- **Reads:** active tab, active space, tabs of a space, grid tabs, grid on/off, grid layout, a tab's state, agent rows, urgent items, a tab's label, refused.
- **Invariants:** enforced at the end of every write, then view state is saved through the port, then the subscriber is notified once, synchronously. They are: **Tab numbers** renumber by position within the space; grid turns off when empty or the **Active tab** is not a pane; the **Active tab** belongs to the **Active space** unless that space has no tabs. Today these run inside painting; they move into the store and run on every write.
- **Reconcile:** replaces the state half of the resync. It sets kind and label from core, keeps detected kinds, marks missing tabs exited unless the core's state was refused, creates tabs, and on first run restores the saved **Active tab**, grid and **Recent order**. View-state restore and the first space selection now happen before the attaches settle, so panes appear blank and fill as attaches complete. If the acceptance test shows this breaks startup, the fallback is to run the attach effects first and then call one more store step; the store's interface does not change.
- **Status merge:** apply status change replaces the agent entry but keeps `resumable` and context from the previous entry; `resumable` is settled by the core's list afterwards. Kind detection re-runs inside set agents and apply status change.
- **Core events:** bridge events are forwarded to the store as plain method calls. There is no bridge-shaped port, because it would have one production adapter and one fake. This decision was weighed and judged easy to reverse, so no ADR.
- **Seam:** the only real seam is persistence: the view-state port (browser storage in production, in-memory in tests, no-op in demo mode).
- **What stays in the entry file:** the DOM-record map and the change loop (create and drop records, swap the agent mark on a kind change, then paint); all core calls and the agent-list refresh; line-change counts; notifications and window raising; host-bus events and the settled decision for them; dialogs; key actions (reading the store); config, appearance, sound, zoom and core-restart wiring; writing the `[process exited]` bytes and attach handling; the grid arranger.
- **Grid math:** layout repair, automatic tree, nudge, swap and neighbour logic stay in the existing pure grid modules. The store holds only the layout; the arranger's tree provider reads from the store and its change callback writes the layout through the store.
- **Sidebar order:** the store reuses the existing pure sidebar space-order function when it reselects after a space is dropped.
- **Settled:** deciding whether an agent state change settled stays where it is today (the diff model); moving it is a separate refactor.
- **Glossary:** **Tab number**, **Exited tab** (with **Resume**), **Active tab / Active space** and **Recent order** are already in the glossary. Implementation terms (store, effects, port) are not added.
- **Slice order** (each slice lands its store tests first and leaves the existing acceptance test, `npm test` and `npm run typecheck` green):
  1. Store core: spaces, tabs, order, agents, active selection, **Recent order**, selection, removal, renumbering, kind detection, status merge and the single kind mapping; the entry file gets the DOM-record map and change loop.
  2. Grid state, its invariant and the view-state port; saving leaves painting.
  3. Reconcile and its effects; the resync body shrinks to: list, reconcile, run effects, set agents.
  4. Demo mode driven through the store with the no-op port.

## Testing Decisions

- A good test drives the store only through its public writes and reads and asserts observable results (the active tab, a tab's number, an agent entry, the returned effects, what the port was asked to save). It never inspects internals, and never needs a DOM.
- **Seam 1, the store interface in plain vitest**, new, named after rules: reconcile restoring the **Active tab**, grid and **Recent order**; reconcile and the refused state; reconcile marking missing tabs exited; kind detection and surviving a reconcile; status merge keeping `resumable` and context; context for a tab with no entry; removal selecting the next tab; dropping a space and reselecting; renumber on close; the grid turning itself off; idempotent add; marking exited and alive; saving through the port after writes.
- **Seam 2, the existing acceptance test** that runs the real entry file under a DOM with a faked core layer. It stays untouched and must pass after every slice. It remains the only guard that the entry file still wires the store to the screen, and keeps the unknown-state hint and grid-toggle checks.
- **Seam 3, the view-state port** is an adapter seam only; production and in-memory adapters are exercised through seams 1 and 2.
- Some of the acceptance test's cases are also re-expressed as store tests: restoring the view state, opening a tab from the CLI leaving the grid alone, the opened-before-reply dedupe, a CLI-added space and typed agent tab states. They stay in the acceptance test too.
- Prior art: the existing tests for the pure sidebar model, view state, recent tabs and grid tree, which are plain-function vitest tests with no DOM.

## Out of Scope

- Changing any behaviour. **Tab number** keeps renumbering on close; whether it should be a stable id is a separate decision for the human.
- Moving the settled decision out of the diff model (a separate architecture candidate).
- Moving the grid tree math, painting, dialogs, config, appearance, sound, zoom or core-restart wiring into the store.
- Line-change counts and their refresh.
- Any change to the core, the protocol or the CLI.
- A bridge-shaped port for core events, an action log, or a generic tab handle.

## Further Notes

- The design came from an architecture survey and a three-round grilling session; the interviewee judged no part hard to reverse, so no ADR is recorded.
- The seams above were proposed to the user and the spec was requested without objection, so they are treated as confirmed.
- The main risk is the changed startup sequencing in slice 3. The acceptance test's startup case is the tripwire, and the fallback is described above.
