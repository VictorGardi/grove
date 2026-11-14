# Research: how the eight preferences behave today (agent report, facts only; paths under packages/ui)

Common pattern: read(store|null) falls back to default on null store, throwing getItem, junk; write is a silent no-op on null store or throwing setItem. KeyValueStore is defined in sidebar-state.ts:6-9. main.ts:1288-1294 storage() returns localStorage or null if access throws; called at every use (main.ts:116-132, 1304-1416); dock gets storage() once (main.ts:234).

| Pref | Key | Stored format | Default | Differs |
|---|---|---|---|---|
| theme | grove.theme | id string | 'grove' | enum validation, write unvalidated |
| zoom | grove.zoom | String(number) | 1 | out of 0.5-3 rejected (not clamped); null read works by accident via Number(null)=0 |
| sound | grove.sound | 'on'/'off' | false | plain |
| appearance | grove.agent-appearance | JSON | fresh copy of default | all-or-nothing validation, extra keys dropped |
| sidebar | grove.sidebar-hidden | '1'/'0' | false | plain; defines KeyValueStore |
| view-state | grove.view-state | JSON | empty() | only one that console.warns (read + write); dedupe, GRID_MAX slice, readTree on read; ViewStatePort / storageViewState / noViewState / memoryViewState |
| dock | grove.dock-width, grove.dock-expanded | String(int), '1'/'0' | 360, false | width: floor 280 on read and write, no ceiling (applied at display); two keys |
| pane-dim | grove.pane-dim | String(number) | null (= theme's opacity) | clamps 0.1-1 on read and write; null default |

Each also holds non-storage helpers (applyThemeChoice, applyAgentAppearance, stepZoom, dock clamps, clampPaneDim) that stay where they are.

Tests: each file has its own copy of a memory() store. Throwing-store cases exist only in sidebar-state.test.ts:27-40 and dock.test.ts:93-102 (expanded only). Null-store and junk fallbacks repeat in every file. status-window.test.ts pins grove.agent-appearance and view-state keys/JSON (must stay unchanged).

Out of scope: per-folder diff prefs live in the core state file, not browser storage.
