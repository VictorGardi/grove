---
id: T-049
title: the loading of models available happen every time i open a task
status: done
created: "2026-04-05T13:40:29.151Z"
planTmuxSession: grove-plan-c0e897-T-049
planSessionId: ses_2a21f3900ffebBAOZJBBH6NtV1
planSessionAgent: opencode
planModel: opencode/big-pickle
execTmuxSession: grove-exec-c0e897-T-049
execSessionId: ses_2a21d5cedffe3vtBXR36ownFCP
execSessionAgent: opencode
execModel: opencode/big-pickle
completed: "2026-04-05T13:47:56.097Z"
---

## Description

The model list for agent dropdowns is fetched every time a task is opened or workspace settings are viewed, causing unnecessary API calls. Refactor `PlanChat.tsx` and `WorkspaceDefaultsForm.tsx` to use the existing `ensureModels` and `modelsCache` from `usePlanStore` instead of calling `listModels` directly.

**Problem locations:**

- `PlanChat.tsx` lines 193-211: calls `window.api.plan.listModels()` directly on mount
- `WorkspaceDefaultsForm.tsx` lines 38-47 and 93-101: calls `listModels` on workspace selection changes

**Existing solution to leverage:**

- `usePlanStore.ts` lines 280-302: `ensureModels` function caches results in `modelsCache`
- `TaskCard.tsx` lines 68-86: already correctly uses this caching pattern

## Definition of Done

- [x] Refactor `PlanChat.tsx` to use `ensureModels` from `usePlanStore` and read from `modelsCache` instead of calling `listModels` directly
- [x] Preserve model validation logic that clears invalid models when the cached list is loaded (lines 202-207 in original)
- [x] Refactor `WorkspaceDefaultsForm.tsx` to use cached models from `usePlanStore`
- [x] Ensure loading states work correctly with cache (null = loading, [] = no models found)
- [x] Verify `TaskCard.tsx` already uses caching (confirmed)
- [ ] Test that models load on first task open and are cached for subsequent opens without reloading

## Context for agent
