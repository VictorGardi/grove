---
id: T-023
title: show opencode/copilot context usage and total usage
status: done
created: '2026-04-04'
planSessionId: ses_2a61124bcffeyQZO4A3l9snALB
planSessionAgent: opencode
planModel: opencode/big-pickle
useWorktree: false
execSessionId: ses_2a5ba959cffe5Ym7p9omIh6jlv
execSessionAgent: opencode
execModel: opencode/big-pickle
---

## Description

Add two UI features to the plan/execution chat:

1. **Context/Token Usage Display**: Parse `step_finish` events from OpenCode JSON output stream to extract token usage (`tokens.total`, `tokens.input`, `tokens.output`, `tokens.cache.read`, `tokens.cache.write`) and display a running total in the chat UI.

2. **Message Timestamps**: Show a timestamp for each message in the chat, displaying when the message was sent (user) or received (agent).

### Technical Implementation

**Files to modify:**

1. `src/shared/types.ts`
   - Add `timestamp?: number` field to `PlanMessage` interface (Unix timestamp in ms)
   - Add `tokens` type to `PlanChunk` union: `{ type: "tokens"; content: string; data: { total: number; input: number; output: number; reasoning: number; cache: { write: number; read: number } } }`

2. `src/main/planManager.ts`
   - In `parseOpencodeLine()`, add handling for `step_finish` events
   - Extract `tokens` object from the event and emit a new `tokens` chunk type
   - Note: Only OpenCode emits `step_finish` with token data; Copilot not in scope

3. `src/renderer/src/stores/usePlanStore.ts`
   - Add `totalTokens: number` field to `PlanSession` interface
   - Modify `appendUserMessage` to set `timestamp: Date.now()`
   - Modify `startAgentMessage` to set `timestamp: Date.now()`
   - Add `updateTokens` action to accumulate token totals from chunks
   - Modify `applyChunk` to handle `tokens` chunk type and update session total

4. `src/renderer/src/components/TaskDetail/PlanChat.tsx`
   - In `ChatMessage` component, display timestamp next to role label (format: "HH:MM")
   - In header area, display running token total (e.g., "Tokens: 1,234" or "🪙 1.2k")
   - Use `session?.totalTokens` from store

### Edge Cases / Notes

- Token counts arrive in `step_finish` events at end of each step — running total should accumulate across all steps in a session
- If `step_finish` fires multiple times per agent run, tokens should sum (not replace)
- Handle missing `tokens` field gracefully (some events may not include it)
- Timestamp should be captured when message is created, not when chunk arrives
- Only OpenCode emits `step_finish` with token data; Copilot is out of scope per requirements

## Definition of Done

- [x] `PlanChunk` type supports tokens data in `src/shared/types.ts`
- [x] `PlanMessage` interface includes optional `timestamp` field
- [x] `parseOpencodeLine` in `planManager.ts` extracts tokens from `step_finish` events
- [x] `applyChunk` in usePlanStore handles tokens chunk and accumulates `totalTokens`
- [x] `appendUserMessage` and `startAgentMessage` set message timestamp
- [x] ChatMessage component displays formatted timestamp (HH:MM) for each message
- [x] Chat header displays running token total for the session
- [x] UI updates in real-time as tokens arrive from agent stream
