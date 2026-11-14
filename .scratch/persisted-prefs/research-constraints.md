# Research: glossary, ADRs, overlapping specs (agent report, facts only)

- No glossary term for preference/setting/storage/view state. Dock: width and expanded are two values, saved width must survive toggling expanded (GLOSSARY.md:78-80). "Module" is taken by DockModule: don't use it for the shared unit.
- ADRs: only 0001 (git reads/writes), no bearing. No conflicts.
- .scratch/window-store spec is already implemented: ViewStatePort, storageViewState, noViewState, memoryViewState, VIEW_STATE_KEY, readViewState/writeViewState exist in view-state.ts; used by window-store.ts, main.ts, tests. status-window.test.ts pins key names and JSON shapes (grove.agent-appearance, view-state) and must stay unchanged.
- Keys: grove.theme, .zoom, .sound ('on'/'off'), .agent-appearance (JSON), .sidebar-hidden ('1'/'0'), .view-state, .dock-width, .dock-expanded ('1'/'0'), .pane-dim.
- Divergences: view-state uses console.warn on failure, the other seven are silent. pane-dim returns null (not a default) when absent. dock width read has floor but no ceiling, write clamps min only. Brief says "a change holds until the window closes", but modules hold nothing themselves; callers keep the in-memory value.
- KeyValueStore lives in sidebar-state.ts; also imported by dock.ts. Vitest is node-only, so tests inject plain objects.
- Per-folder diff prefs live in the core, not browser storage (out of scope anyway).
