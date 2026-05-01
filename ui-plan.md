# UI Plan: Floating Input Box (openchamber-style)

## Context

The current chat input is a full-width two-bar stack at the bottom of the panel: a separate `.controlsBar` with agent/model selectors above a `.inputArea` with the textarea and send button. This is visually heavy and doesn't match the clean floating-box aesthetic of openchamber.

The goal is to collapse both bars into a single centered, floating rounded-corner input box with controls inline in the bottom row, plus a Shift+Tab shortcut to toggle between plan and build (execute) modes.

---

## Files to Modify

- `src/renderer/src/components/TaskDetail/TaskEventStream.tsx`
- `src/renderer/src/components/TaskDetail/TaskEventStream.module.css`

No changes to `TaskDetailPanel.tsx` — `mode` prop continues to be passed as before.

---

## 1. CSS Changes (`TaskEventStream.module.css`)

### Remove / repurpose

- `.controlsBar` — remove (merged into input box footer)
- `.controlSelect` — keep but update for inline use (smaller, no border radius override needed)
- `.inputArea` — repurpose as the outer padding/centering wrapper
- `.inputTextarea` — simplify (transparent bg, no border)
- `.inputFooter` — replace with `.inputBoxFooter`

### New / updated rules

```css
/* Outer padding wrapper — sits at bottom of .wrapper */
.inputArea {
  padding: 0 16px 16px;
  background: var(--bg-base);
}

/* The floating box itself */
.inputBox {
  max-width: 720px;
  margin: 0 auto;
  background: var(--bg-elevated);
  border: 1px solid var(--border-dim);
  border-radius: 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: box-shadow 0.15s;
}

.inputBox:focus-within {
  border-color: var(--accent);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.22);
}

/* Transparent textarea — fills the top of the box */
.inputTextarea {
  width: 100%;
  padding: 14px 16px 6px;
  min-height: 72px;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  font-size: 14px;
  font-family: inherit;
  color: var(--text-primary);
  line-height: 1.5;
}

.inputTextarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Bottom row: mode pill | agent | model — spacer — thinking | send */
.inputBoxFooter {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 10px;
}

/* Mode toggle pill (plan / build) */
.modeBadge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 99px;
  border: 1px solid var(--border-dim);
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  user-select: none;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}

.modeBadge:hover {
  background: var(--bg-hover);
}

.modePlan {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
}

.modeBuild {
  color: var(--status-green);
  border-color: color-mix(in srgb, var(--status-green) 40%, transparent);
}

/* Spacer pushes right-side controls to the end */
.inputBoxSpacer {
  flex: 1;
}

/* Inline selectors (agent + model) */
.controlSelect {
  padding: 3px 6px;
  font-size: 12px;
  border: 1px solid var(--border-dim);
  border-radius: 6px;
  background: var(--bg-base);
  color: var(--text-primary);
  cursor: pointer;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.controlSelect:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Send / Stop buttons (slightly smaller to fit inline) */
.sendButton {
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  background: var(--accent-blue);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
}

.sendButton:hover:not(:disabled) {
  background: var(--accent-hover);
}

.sendButton:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.stopButton {
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  background: var(--status-red);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  flex-shrink: 0;
}

.stopButton:hover {
  opacity: 0.85;
}

/* Keep thinkingBadge / waitingBadge positioning in footer */
.thinkingBadge {
  font-size: 12px;
  color: var(--accent-blue);
  animation: pulse 1.5s infinite;
  flex-shrink: 0;
}

.waitingBadge {
  font-size: 12px;
  color: var(--accent-yellow);
  flex-shrink: 0;
}
```

Also add to `@keyframes busyDot` block (already exists) — no change needed.

Remove the `border-top` from `.inputArea` (was separating old controlsBar from textarea).

---

## 2. TSX Changes (`TaskEventStream.tsx`)

### 2a. Internal mode state

Add after the existing `useState` declarations (around line 76):

```tsx
const [activeMode, setActiveMode] = useState<"plan" | "execute">(mode);
```

Replace **every** use of the `mode` prop variable with `activeMode`:
- `chatKey` computation
- Agent/model initialization (`task?.execSessionAgent` vs `task?.planSessionAgent`)
- Session persistence `frontmatterUpdate` block

### 2b. Extract reattach logic into a callable helper

The one-time `reattachRef` effect currently hardcodes `initialChat.sessionId`. Extract the subscription part into a named callback so it can be called again on mode switch:

```tsx
const doReattach = useCallback(async (targetSessionId: string) => {
  if (!task) return;
  try {
    const serverResult = await window.api.opencodeServer.ensure();
    if ("error" in serverResult) return;
    const client = createClient(serverResult.url);
    clientRef.current = client;
    const directory = task.worktree ?? workspacePath;
    await startSubscription(client, directory, targetSessionId);
  } catch {
    // server not running yet
  }
}, [task, workspacePath, startSubscription]);
```

Update the `reattachRef` effect to call `doReattach(initialChat.sessionId)`.

### 2c. Mode switch handler

```tsx
const handleModeSwitch = useCallback((newMode: "plan" | "execute") => {
  if (newMode === activeMode) return;

  // Abort current stream
  streamAbortRef.current?.();
  streamAbortRef.current = null;
  clientRef.current = null;

  // Load persisted chat state for the new mode
  const newChatKey = `${taskId}-${newMode}`;
  const chat = useAgentChatStore.getState().getChat(newChatKey);
  setMessages(chat.messages);
  const newSessionId = chat.sessionId ?? null;
  setSessionId(newSessionId);
  sessionIdRef.current = newSessionId;

  // Reset transient state
  setSessionStatus("idle");
  setErrorMsg(null);
  setIsUserScrolled(false);
  setPermissionRequest(null);
  setQuestionRequest(null);

  // Update agent/model for new mode
  const taskData = useDataStore.getState().tasks.find((t) => t.id === taskId);
  if (taskData) {
    setSelectedAgent(
      ((newMode === "execute" ? taskData.execSessionAgent : taskData.planSessionAgent) ?? "opencode") as PlanAgent,
    );
    setSelectedModel((newMode === "execute" ? taskData.execModel : taskData.planModel) ?? "");
  }

  setActiveMode(newMode);

  // Reattach to existing session if any
  if (newSessionId) {
    void doReattach(newSessionId);
  }
}, [activeMode, taskId, doReattach]);
```

### 2d. Keyboard handler update

In the textarea `onKeyDown`, add before the Cmd+Enter check:

```tsx
if (e.key === "Tab" && e.shiftKey) {
  e.preventDefault();
  handleModeSwitch(activeMode === "plan" ? "execute" : "plan");
  return;
}
```

### 2e. New JSX structure

Remove the entire `{/* Agent + Model selectors */}` `.controlsBar` block.

Replace the `{/* Input area */}` `.inputArea` block with:

```tsx
{/* Input area */}
<div className={styles.inputArea}>
  <div className={styles.inputBox}>
    <textarea
      ref={textareaRef}
      className={styles.inputTextarea}
      placeholder="Type a message…"
      value={userInput}
      onChange={(e) => setUserInput(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Tab" && e.shiftKey) {
          e.preventDefault();
          handleModeSwitch(activeMode === "plan" ? "execute" : "plan");
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          handleSend();
        }
      }}
      disabled={isBusy}
      autoFocus
      rows={3}
    />

    <div className={styles.inputBoxFooter}>
      {/* Mode pill */}
      <button
        className={`${styles.modeBadge} ${activeMode === "plan" ? styles.modePlan : styles.modeBuild}`}
        onClick={() => handleModeSwitch(activeMode === "plan" ? "execute" : "plan")}
        title="Shift+Tab to switch mode"
      >
        {activeMode === "plan" ? "plan" : "build"}
      </button>

      {/* Agent selector */}
      <select
        className={styles.controlSelect}
        value={selectedAgent}
        onChange={(e) => setSelectedAgent(e.target.value as PlanAgent)}
        disabled={hasSession}
      >
        <option value="opencode">opencode</option>
        <option value="copilot">copilot</option>
        <option value="claude">claude</option>
      </select>

      {/* Model selector */}
      <select
        className={styles.controlSelect}
        value={selectedModel}
        onChange={(e) => setSelectedModel(e.target.value)}
        disabled={hasSession || availableModels.length === 0}
        title={selectedModel}
      >
        {availableModels.length === 0 && (
          <option value="">Loading…</option>
        )}
        {availableModels.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      <span className={styles.inputBoxSpacer} />

      {/* Status indicators */}
      {isBusy && (
        <span className={questionRequest ? styles.waitingBadge : styles.thinkingBadge}>
          {questionRequest ? "Waiting…" : <BusyDots />}
        </span>
      )}
      {sessionStatus === "retry" && (
        <span className={styles.statusRetry}>Retrying…</span>
      )}

      {/* Send / Stop */}
      {isBusy ? (
        <button className={styles.stopButton} onClick={handleStop}>Stop</button>
      ) : (
        <button className={styles.sendButton} onClick={handleSend} disabled={!canSend}>
          Send
        </button>
      )}
    </div>
  </div>
</div>
```

---

## 3. Behaviour Notes

| Action | Result |
|---|---|
| Shift+Tab in textarea | Toggles plan ↔ build mode, reloads persisted history |
| Click mode pill | Same toggle |
| Mode switches when task status changes | TaskDetailPanel remounts component via key — activeMode resets to prop value automatically |
| Model names are long | `max-width: 140px` + `text-overflow: ellipsis` on select; `title={selectedModel}` shows full name on hover |
| Existing session on mode switch | `doReattach` resubscribes to the SSE stream for that session |

---

## 4. Verification

1. Run `npm run dev` and open a task
2. Chat input should appear as a floating rounded box centered in the panel, not full-width
3. Agent + model selectors visible in the bottom row of the input
4. Mode pill shows "plan" or "build" with accent colour
5. Pressing Shift+Tab in the textarea toggles mode pill and loads different chat history
6. Clicking mode pill also toggles
7. Cmd+Enter still sends message
8. Stop button appears when session is busy
9. Thinking / BusyDots still animates in footer row
10. TypeScript: `npx tsc --noEmit -p tsconfig.web.json` — no new errors in changed files
