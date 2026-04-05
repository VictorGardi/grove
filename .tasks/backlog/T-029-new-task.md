---
id: T-029
title: include thinking in chat
status: backlog
created: "2026-04-05"
useWorktree: false
---

## Description

Display the model's thinking/reasoning process in the chat UI for both OpenCode and Copilot agents. This allows users to see the AI's reasoning before its final response.

**Current State:**

- OpenCode already emits thinking blocks in JSON format when the model supports extended thinking (`part.type === "thinking"`)
- Copilot emits `assistant.reasoning_delta` (streaming) and `assistant.reasoning` (complete) events with `deltaContent`/`content` fields
- The UI already has a `ThinkingBlock` component (PlanChat.tsx:87-104) and renders thinking via the `thinking` field on `PlanMessage`
- The store already handles `thinking` chunks (usePlanStore.ts:148-152)

**What's Missing:**

1. **Copilot parsing** - Need to extract `assistant.reasoning_delta` and `assistant.reasoning` events from Copilot's JSON output
2. **Display is already in place** - The existing `ThinkingBlock` UI will display thinking content automatically once it's properly parsed and stored

## Implementation Details

### 1. Update Copilot JSON parsing (src/main/planManager.ts)

Add handling for Copilot reasoning events in `parseCopilotLine()`:

```typescript
// Handle assistant.reasoning_delta (streaming) - obj.data.deltaContent
if (
  obj.type === "reasoning_delta" &&
  obj.data &&
  typeof obj.data.deltaContent === "string" &&
  obj.data.deltaContent.trim()
) {
  chunks.push({ type: "thinking", content: obj.data.deltaContent });
}

// Handle assistant.reasoning (complete) - obj.data.content
if (
  obj.type === "reasoning" &&
  obj.data &&
  typeof obj.data.content === "string" &&
  obj.data.content.trim()
) {
  chunks.push({ type: "thinking", content: obj.data.content });
}
```

### 2. Enable reasoning for Copilot

Add `--reasoning-effort high` to Copilot CLI args in the message builder (PlanChat.tsx) to ensure reasoning is reliably available:

```typescript
args.push("--reasoning-effort", "high");
```

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

- [ ] Add Copilot reasoning parsing in planManager.ts (handle `assistant.reasoning_delta` and `assistant.reasoning` events)
- [ ] Add `--reasoning-effort high` to Copilot CLI args to ensure reasoning is emitted
- [ ] Verify OpenCode thinking displays correctly (ThinkingBlock appears with content when model emits thinking)
- [ ] Verify Copilot thinking displays correctly (ThinkingBlock appears with reasoning content)
- [ ] Test with both plan and execute chat modes
- [ ] Verify reasoning accumulates correctly across multiple streaming chunks
- [ ] Verify ThinkingBlock is collapsible and shows "Thinking..." toggle

## Context for agent
