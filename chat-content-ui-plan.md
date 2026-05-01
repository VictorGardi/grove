# Chat Content UI Plan — Grove

Reference: [openchamber/openchamber](https://github.com/openchamber/openchamber)

This document outlines how to bring openchamber-quality chat rendering to Grove. Each section describes the gap, what openchamber does, and the concrete implementation plan for Grove.

---

## 1. Rich Tool Output Renderers

### Gap
Grove renders tool args/output as truncated raw JSON/text inside a collapsible card. openchamber renders each tool's output with purpose-built formatters.

### What openchamber does
- **grep output** — grouped by filepath, each file gets a header, then line-number + content rows with the matched term highlighted
- **glob/list output** — grid layout with file icons, directories distinguished from files
- **todo output** — JSON parsed into a structured list with color-coded priority dots, status icons (checkmark, X, ellipsis) grouped by status (in_progress / pending / completed / cancelled)
- **web search output** — results as cards with title, URL chip, and snippet
- **diff output** — side-by-side or unified diff viewer via `parseDiffToLines()`

### Plan for Grove

**`src/renderer/src/components/TaskDetail/toolRenderers/`** — new folder:

| File | Renders |
|---|---|
| `GrepOutput.tsx` | Groups matches by file path, highlights the matched substring in each line |
| `GlobOutput.tsx` | Grid of filename chips with file-type icons |
| `TodoOutput.tsx` | Parses JSON todo array → structured list with status + priority badges |
| `WebSearchOutput.tsx` | Card list with title, URL, snippet |
| `DiffOutput.tsx` | Unified diff with `+`/`-` line coloring |

**`ToolCallCard.tsx`** changes:
- Add a `selectRenderer(toolName, output)` function that returns the appropriate renderer component or falls back to the current raw text display.
- Pass parsed JSON (not raw string) to renderers.

**Priority**: High — biggest visible win, especially for grep/glob/todo which are the most common tools.

---

## 2. Inline File Path Detection & Clickable Links

### Gap
Grove displays file paths in markdown as plain text. openchamber detects filesystem paths in any message content and converts them into clickable elements that open the file.

### What openchamber does
- `useFileReferenceInteractions` hook scans rendered markdown for path-like strings (contain `/` or `\`, have a file extension, or are in code spans)
- Matched paths become `<button>` or `<a>` elements that trigger the editor open action
- Runtime-aware: uses VS Code `vscode.open` or Electron `shell.openPath`

### Plan for Grove

1. **`src/renderer/src/hooks/useFileLinks.ts`** — new hook:
   - Regex: `/(\/[\w.\-/]+\.[\w]+)/g` applied to plain text segments of markdown
   - Returns a map of `{ path → absolutePath }` after resolving against the workspace root
   - Calls `window.electron.openFile(absolutePath)` or opens in Grove's file viewer

2. **Custom `a`/`code` component in `StreamingText.tsx`**:
   - After markdown is rendered, intercept `<code>` inline elements that match path regex
   - Wrap with a `<button className={styles.fileLink}>` that fires `openFile`

3. **CSS** — add to `TaskEventStream.module.css`:
   ```css
   .fileLink {
     color: var(--accent-blue);
     text-decoration: underline dotted;
     cursor: pointer;
     font-family: var(--font-mono);
     font-size: 0.85em;
   }
   .fileLink:hover { text-decoration: underline solid; }
   ```

**Priority**: Medium — useful but requires care to avoid false positives on non-path strings.

---

## 3. Stable Markdown Blocks (No Re-render Flicker During Streaming)

### Gap
Grove currently renders raw monospace text while streaming, then switches to markdown. This causes a visual jump. openchamber avoids this by streaming markdown incrementally without switching rendering mode.

### What openchamber does
- `useStableMarkdownBlocks()` splits the incoming markdown string into logical blocks (paragraph, code fence, heading, etc.) using a simple state machine
- Each block is rendered independently; only the last (incomplete) block re-renders
- Previously completed blocks are memoized and never touch the DOM

### Plan for Grove

1. **`src/renderer/src/hooks/useStableMarkdownBlocks.ts`** — new hook:
   ```ts
   // Returns an array of stable block strings
   // Each element is a self-contained markdown chunk
   function useStableMarkdownBlocks(text: string): string[]
   ```
   Split on double-newline and code fence boundaries. Keep incomplete trailing block in a separate "live" slot.

2. **`StreamingText.tsx`** changes:
   - Remove the `isStreaming` → raw text branch
   - Use `useStableMarkdownBlocks(text)` to get `stableBlocks` + `liveBlock`
   - Render `stableBlocks` with `React.memo`'d `<MarkdownBlock>` components (never re-render)
   - Render `liveBlock` with a single `<ReactMarkdown>` (re-renders on each token)

**Priority**: Medium — eliminates the jarring mode-switch, improves perceived streaming quality.

---

## 4. Mermaid Diagrams in Chat

### Gap
Grove already supports Mermaid in `MarkdownViewer.tsx` (file browser) but not in the chat `StreamingText` component.

### What openchamber does
- Detects ` ```mermaid ` fenced code blocks via language classifier
- Renders with `beautiful-mermaid` / the `mermaid` library inside a sandboxed `<div>`
- Click-to-preview opens a modal with the full diagram

### Plan for Grove

1. Extend the `ChatCodeBlock` component in `StreamingText.tsx`:
   ```tsx
   if (language === 'mermaid') {
     return <MermaidBlock code={children} />
   }
   ```

2. **`MermaidBlock.tsx`** — reuse the existing Mermaid rendering logic from `MarkdownViewer.tsx`, extracted into a shared component at `src/renderer/src/components/shared/MermaidBlock.tsx`.

3. No new dependencies needed — `mermaid` is already in the project.

**Priority**: Low-Medium — nice to have for architecture diagrams, flowcharts.

---

## 5. Tool Call Card — Live Duration Timer & Richer Status

### Gap
Grove's `ToolCallCard` shows a spinner while running but no elapsed time. openchamber shows a live-updating duration counter.

### What openchamber does
- `ToolPart.tsx` stores a `startTime` ref when status becomes `running`
- A `useEffect` with `setInterval(100ms)` updates a `elapsedMs` state
- Rendered as `(1.4s)` next to the tool name
- Stops ticking when status changes from `running`

### Plan for Grove

In `ToolCallCard.tsx`:

```tsx
const startTimeRef = useRef<number | null>(null);
const [elapsed, setElapsed] = useState(0);

useEffect(() => {
  if (status === 'running') {
    startTimeRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current!);
    }, 100);
    return () => clearInterval(id);
  }
}, [status]);

// In render:
{status === 'running' && <span className={styles.elapsed}>{(elapsed / 1000).toFixed(1)}s</span>}
```

**Priority**: Low — small polish item but meaningfully improves feedback for long-running tools.

---

## 6. Text Selection Menu

### Gap
Grove has no text-selection actions. openchamber shows a floating menu when the user selects text in a message.

### What openchamber does
- `TextSelectionMenu.tsx` listens for `mouseup` on the message container
- If `window.getSelection().toString()` is non-empty, a floating popover appears near the selection
- Actions: Copy, Add to chat (inserts quoted text into input), Add to notes (with optional AI summarization), Create new session with selection as context

### Plan for Grove

1. **`src/renderer/src/components/TaskDetail/TextSelectionMenu.tsx`** — new component:
   - `useEffect` on `mouseup` at `document` level
   - On non-empty selection within the message list container: show a `<div>` positioned via `getClientRects()`
   - Actions for Grove: **Copy** and **Quote in input** (inserts `> selected text\n\n` into the input textarea)

2. Wrap the message list in `EventMessage.tsx` with a `ref` and pass it to `TextSelectionMenu`.

**Priority**: Medium — "Quote in input" is the most useful action and straightforward to implement.

---

## 7. Syntax Highlighting Theme & Code Block Polish

### Gap
Grove's Shiki integration works but code blocks lack the small UX details openchamber has.

### What openchamber does
- Code blocks show a **language badge** in the top-right corner
- **Line numbers** column (optional, enabled for blocks > 5 lines)
- **Copy** button visible on hover with a checkmark confirmation
- For bash/shell blocks: renders with a terminal-style dark background regardless of theme
- Virtualized rendering for very large code blocks (only visible lines are in the DOM)

### Plan for Grove

Extend `ChatCodeBlock` in `StreamingText.tsx`:

1. **Language badge**: already partially present — make it consistently styled in top-right
2. **Copy with checkmark**: replace the current copy button state with a 1.5s "Copied ✓" flash
3. **Terminal background**: if `language` is `bash`, `sh`, `zsh`, `fish`, `shell`, apply `.terminalBlock` CSS class that forces a dark background + lighter text regardless of theme
4. **Line numbers**: add an optional `showLineNumbers` prop, enabled when `children.split('\n').length > 8`

```css
/* TaskEventStream.module.css additions */
.terminalBlock { background: #1a1a1a; color: #e0e0e0; }
.lineNumbers { color: var(--text-muted); user-select: none; padding-right: 1em; }
```

**Priority**: Medium — the terminal background and copy confirmation are quick wins.

---

## 8. Reasoning Traces — Timeline View

### Gap
Grove collapses reasoning into a plain `<details>` element. openchamber renders reasoning as a structured timeline with relative timing.

### What openchamber does
- `ReasoningPart.tsx` renders a vertical timeline
- Each reasoning block has a timestamp offset relative to message start
- The timeline uses a left border with dot markers at each step

### Plan for Grove

If the model emits reasoning parts (thinking blocks), render them as:

```
┌─ Thinking ─────────────────────────────┐
│  • Analyzing the file structure...     │
│  • Found 3 relevant functions          │
└────────────────────────────────────────┘
```

1. Detect reasoning parts in `EventMessage.tsx` (parts with `type === 'reasoning'`)
2. Wrap in a `<details>` that defaults to collapsed but opens while streaming
3. Inside: vertical `<ul>` with left-border CSS timeline styling
4. Add elapsed time badge if `time.start` and `time.end` are available: `(2.3s)`

**Priority**: Low — only matters if the configured model emits reasoning tokens.

---

## 9. Permission Request UI Improvements

### Gap
The current permission dialog is functional but minimal. openchamber turns permission requests into clear, actionable cards.

### What openchamber does
- Permission requests shown as a distinct card (not just a dialog)
- Shows the **tool name**, **what it will do** (parsed from the request), and the **exact command/path**
- Buttons: Allow, Allow Always, Deny

### Plan for Grove

The current `QuestionCard` handles both questions and permissions. Split them:

1. **`PermissionCard.tsx`** — dedicated component:
   - Shows a warning icon + tool name as header
   - Renders the permission message in a styled code block (for commands/paths)
   - Three buttons: Allow, Allow Always, Deny
   - Uses amber/yellow accent to signal it needs attention

**Priority**: Medium — improves the trust/safety UX for agent tool calls.

---

## Implementation Order

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 1 | Rich tool output renderers (grep, glob, todo) | M | High |
| 2 | Code block polish (terminal bg, copy confirm, line numbers) | S | Medium |
| 3 | Live duration timer in tool cards | XS | Medium |
| 4 | Stable markdown blocks (no streaming flicker) | M | Medium |
| 5 | Inline file path detection | M | Medium |
| 6 | Text selection → quote in input | S | Medium |
| 7 | Mermaid diagrams in chat | S | Low-Medium |
| 8 | Permission card component | S | Medium |
| 9 | Reasoning timeline view | S | Low |

**Sizes**: XS < 1h, S 1-2h, M 2-4h

---

## Technical Notes

- All new components should use CSS Modules (`.module.css`) consistent with the existing pattern
- Grove uses Shiki (not Prism) — no need to add Prism
- Mermaid is already a dependency — no new packages needed for items 1-8
- The only potentially new dependency is a diff-parsing utility for `DiffOutput.tsx` (consider `diff` npm package, ~5KB)
- Keep all renderers behind the existing `ToolCallCard` expand/collapse — they replace the inner content only
- Test with dark + light themes; Grove's `--accent-*` CSS variables should be used throughout for theme consistency
