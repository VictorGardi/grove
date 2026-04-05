---
id: T-041
title: possible to set default agent + model in a repo
status: done
created: "2026-04-05"
planSessionId: ses_2a29f53dcffeK6EXn5073sTmA8
planSessionAgent: opencode
planModel: opencode/big-pickle
execTmuxSession: grove-exec-c0e897-T-041
execSessionId: ses_2a27cc161ffervx3QlD3rm0Vpk
execSessionAgent: opencode
execModel: opencode/big-pickle
---

## Description

Add workspace settings UI where users can configure per-workspace defaults for planning and execution:

- **Planning defaults**: agent (opencode/copilot) and model
- **Execution defaults**: agent (opencode/copilot) and model

Settings stored in app config (`~/.config/grove/config.json`) under each workspace entry. When creating a new planning or execution session, if no explicit agent/model is selected, use the workspace defaults. Fall back to current behavior if not configured.

### UI Structure

```
Settings
├── Appearance (existing)
└── Workspace Defaults
    ├── [WorkspaceDropdown: "Select workspace..."]
    ├── Planning Defaults
    │   ├── Agent: [Dropdown: opencode | copilot]
    │   └── Model: [Dropdown: (loaded from agent)]
    └── Execution Defaults
        ├── Agent: [Dropdown: opencode | copilot]
        └── Model: [Dropdown: (loaded from agent)]
```

- Workspace selector: dropdown showing workspace names. If no workspace selected, form is disabled.
- Model dropdown: uses existing `window.api.plan.listModels({agent, workspacePath})`, called on agent change. Show loading state while fetching.
- Priority: task frontmatter → workspace defaults → agent default ('opencode')

### Data Flow

- **Config schema**: Add 4 optional fields to `WorkspaceEntry` in `src/shared/types.ts`
- **IPC**: Add `workspace:getDefaults` and `workspace:setDefaults` handlers in `src/main/ipc/workspace.ts`
- **State**: Extend `useWorkspaceStore` with defaults or create new store

### Edge Cases

- Configured agent not installed → show error toast
- Workspace removed from config → show warning, clear form
- Invalid stored model → log warning, clear to empty

## Definition of Done

### Step 1: Config schema

- [x] Add fields to `WorkspaceEntry` in `src/shared/types.ts`: `defaultPlanningAgent?`, `defaultPlanningModel?`, `defaultExecutionAgent?`, `defaultExecutionModel?`

### Step 2: IPC handlers

- [x] Add `workspace:getDefaults` handler in `src/main/ipc/workspace.ts`
- [x] Add `workspace:setDefaults` handler in `src/main/ipc/workspace.ts`

### Step 3: Store updates

- [x] Add `workspaceDefaults` state to `useWorkspaceStore` or create `useWorkspaceSettingsStore`
- [x] Add `fetchDefaults(path)` and `updateDefaults(path, defaults)` actions

### Step 4: Settings UI

- [x] Create `WorkspaceDefaultsForm.tsx` component in Settings view
- [x] Add workspace dropdown selector at top
- [x] Add 4 dropdowns (planning/execution × agent/model)
- [x] Wire model dropdown to `window.api.plan.listModels()`
- [x] Add loading states and disabled state when no workspace selected

### Step 5: Apply defaults to PlanChat

- [x] In `PlanChat.tsx:197-198`, read workspace defaults when initializing session
- [x] Priority: task-frontmatter → workspace-defaults → 'opencode'/''

### Step 6: Validation

- [x] In PlanChat init, check if model exists in available list; log warning and clear if invalid

### Step 7: Tests

- [ ] Unit test config serialization round-trip
- [ ] Unit test default value fallback logic in PlanChat

## Context for agent
