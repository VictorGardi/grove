# Streaming UI Improvement Plan

## Problem Statement
The TaskEventStream UI feels like "dumps" rather than smooth streaming. Tool calls take up too much space and are expanded by default.

## Root Causes
1. **No `message.part.delta` handling** - Openchamber uses `message.part.delta` events for incremental text updates; Grove ignored these
2. **Tool calls expanded by default** - `ToolCallCard` defaults to expanded state when in-flight
3. **No throttling** - Text updates triggered re-renders on every SSE event (no rate limiting)
4. **SSE only** - No WebSocket transport (higher latency)

## Phases

### Phase 1: Fix Core Streaming Issues (Critical) ✅ COMPLETED
- ✅ Handle `message.part.delta` events with incremental text updates (like openchamber)
- ✅ Add `appendDelta` utility with overlap detection (from openchamber's `appendNonOverlappingDelta`)
- ✅ Collapse tool calls by default (show compact summary like openchamber)
- ✅ Remove auto-expand behavior in `ToolCallCard`

### Phase 2: Enhanced Streaming (Important) ✅ COMPLETED
- ✅ Implement `useStreamingThrottle` hook (33ms throttle like openchamber's FLUSH_FRAME_MS)
- ✅ Update `StreamingText` and `StreamingReasoning` to use throttle
- ✅ Add streaming lifecycle tracking (`streamingMessageId`, response timing)
- ✅ Reset throttle when part ID changes (new content)

### Phase 3: Transport Layer (Optional) ⏳ NOT STARTED
- Add WebSocket support with SSE fallback (like openchamber)
- Implement transport switching logic
- Add reconnection handling

## Implementation Summary

### Files Modified

1. **`src/renderer/src/hooks/useStreamingThrottle.ts`** (NEW)
   - Throttles text display updates during streaming
   - 33ms throttle interval matching openchamber
   - Resets when `identityKey` changes (new part)
   - Immediate update when streaming completes

2. **`src/renderer/src/components/TaskDetail/StreamingText.tsx`**
   - Now uses `useStreamingThrottle` hook
   - Passes `partId` for proper throttle reset
   - Smooth text updates during streaming

3. **`src/renderer/src/components/TaskDetail/StreamingReasoning.tsx`**
   - Refactored to use shared `useStreamingThrottle` hook
   - Removed duplicate throttle logic
   - Consistent behavior with `StreamingText`

4. **`src/renderer/src/components/TaskDetail/TaskEventStream.tsx`**
   - Added `message.part.delta` handler (lines 245-291)
   - Added `appendDelta` with overlap detection (lines 228-240)
   - Added streaming lifecycle tracking (`streamingMessageId`)
   - Track when session goes busy→idle to calculate response duration
   - Store `agentMode` with each message for display

5. **`src/renderer/src/components/TaskDetail/ToolCallCard.tsx`**
   - Changed default to collapsed (line 44)
   - Removed auto-expand on mount
   - Tools stay compact like openchamber

6. **`src/renderer/src/components/TaskDetail/EventMessage.tsx`**
   - Passes `partId` to `StreamingText` for throttle identity

## Key Improvements

1. **Smooth streaming** - Text now streams incrementally via `message.part.delta` events with proper delta appending
2. **Throttled updates** - Display updates max every 33ms (matching openchamber's flush frame)
3. **Compact tool calls** - Tools collapsed by default, matching openchamber's UI
4. **Lifecycle tracking** - Know when streaming starts/completes, calculate response duration
