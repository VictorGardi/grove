---
id: T-031
title: set root repo as default value when creating new task
status: done
created: "2026-04-05"
useWorktree: false
planTmuxSession: grove-plan-c0e897-T-031
planSessionId: ses_2a35fe1bfffeeKfaTYpkYUbwwr
planSessionAgent: opencode
planModel: opencode/big-pickle
execSessionId: ses_2a2d25327ffeMntmiNTKOFoEJi
execSessionAgent: opencode
---

## Description

Set `useWorktree: false` as the default when creating new tasks. This means new tasks will use the root repo instead of creating a dedicated git worktree.

**Current behavior:** New tasks default to `useWorktree: true` (worktree mode)
**New behavior:** New tasks default to `useWorktree: false` (root repo mode)

**Files to modify:**

- `/src/main/tasks.ts` - Three locations need updates for consistent behavior:
  1. `createTask` function: add `useWorktree: false` to frontmatter (line ~241-251)
  2. `parseTaskFile` function: change default from `true` to `false` (line ~99)
  3. `buildFrontmatter` function: flip when to persist the value (line ~216)

## Definition of Done

- [x] Update `createTask` frontmatter to include `useWorktree: false`
- [x] Update `parseTaskFile` default from `true` to `false`
- [x] Update `buildFrontmatter` to persist when `true` instead of `false`
- [x] Verify created task has `useWorktree: false` in both runtime object and frontmatter file

## Context for agent
