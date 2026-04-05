---
id: T-029
title: include thinking in chat
status: backlog
created: "2026-04-05"
useWorktree: false
planSessionId: ses_2a2a07c2effeKruj7QDuuv5aAu
planSessionAgent: opencode
planModel: opencode/big-pickle
---

## Description

Display the model's thinking/reasoning process in the chat UI for both OpenCode and Copilot agents. This allows users to see the AI's reasoning before its final response.

**Current State:**

- OpenCode thinking: **Already implemented** in planManager.ts:168-170 - parses `part.type === "thinking"` blocks and stores them correctly
- Copilot: Only handles `session_id`, `message`, `delta` events in parseCopilotLine() at lines 176-196
- The UI already has a `ThinkingBlock` component (PlanChat.tsx:87-104) and renders thinking via the `thinking` field on `PlanMessage`
- The store already handles `thinking` chunks (usePlanStore.ts:148-152)

**What's Missing:**

1. **Copilot reasoning parsing** - Need to extract `reasoning_delta` and `reasoning` events from Copilot's JSON output (planManager.ts:176-196)
2. Display is already in place - The existing `ThinkingBlock` UI will display thinking content automatically once parsed and stored

## Implementation Details

### 1. Update Copilot JSON parsing (src/main/planManager.ts:176-196)

Add handling for Copilot reasoning events in `parseCopilotLine()`:

```typescript
// Handle reasoning_delta (streaming) - obj.data.deltaContent
if (
  obj.type === "reasoning_delta" &&
  obj.data &&
  typeof (obj.data as Record<string, unknown>).deltaContent === "string"
) {
  const delta = (obj.data as Record<string, unknown>).deltaContent as string;
  if (delta.trim()) {
    chunks.push({ type: "thinking", content: delta });
  }
}

// Handle reasoning (complete) - obj.data.content
if (
  obj.type === "reasoning" &&
  obj.data &&
  typeof (obj.data as Record<string, unknown>).content === "string"
) {
  const content = (obj.data as Record<string, unknown>).content as string;
  if (content.trim()) {
    chunks.push({ type: "thinking", content: content });
  }
}
```

Note: Also apply same fix to tmuxSupervisor.ts:655 `parseCopilotLine()`.

### 2. Enable reasoning for Copilot

The `--reasoning-effort` flag does NOT exist for `copilot cli`. Reasoning is controlled via config file at `~/.copilot/config.json` with property `reasoning_effort`. Users should configure this separately - no code change needed in Grove.

### 3. No UI changes needed

The existing infrastructure already supports:

- `PlanChunk` type with `thinking` type (defined in types.ts)
- `PlanMessage.thinking` field
- `ThinkingBlock` component in PlanChat.tsx (collapsible, shows "Thinking...")
- Store handling in `applyChunk()` that accumulates thinking content

### 4. Edge case handling

- Empty reasoning chunks are filtered out (trim check in parsing)
- If model doesn't support reasoning, thinking block simply won't appear (no error)
- The store already handles accumulation across multiple chunks

## Definition of Done

- [ ] Add Copilot reasoning parsing in planManager.ts (handle `reasoning_delta` and `reasoning` events with `data.deltaContent`/`data.content`)
- [ ] Add same fix to tmuxSupervisor.ts:655 `parseCopilotLine()`
- [ ] Verify OpenCode thinking displays correctly (ThinkingBlock appears with content when model emits thinking)
- [ ] Verify Copilot thinking displays correctly (ThinkingBlock appears with reasoning content)
- [ ] Test with both plan and execute chat modes
- [ ] Verify reasoning accumulates correctly across multiple streaming chunks
- [ ] Verify ThinkingBlock is collapsible and shows "Thinking..." toggle

## Context for agent
