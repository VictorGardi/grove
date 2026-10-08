---
feature: 2026-10-07-review-comments
phase: design
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 01-questions.md@1
  - 02-research.md@1
forced: []
---

# Review comments — design

On 2026-10-07 the human delegated the technical decisions to the agent. The
one-way decisions below are its recommendations; the product answers stand.

## Desired state

1. **Diff:** a gutter **+** (shift-click for a range) opens an editor under
   the line; saving makes a draft in that session's tray.
2. **Markdown:** selecting text shows **Comment**; the draft's text stays
   highlighted.
3. **Review tray:** per session, from **Review (n)** in the session header.
   Drafts by file with their quote: edit, delete, jump to. Plus one note.
4. **Send:** the whole tray goes to the session's tmux pane as one message,
   even while `working`. A `gone` agent session is resumed first.
5. **Sent:** moved to a collapsed **Sent** list with the time; not inline.
6. **Persistence:** drafts survive restarts and re-anchor on file changes;
   unplaceable ones show as **orphaned** and can still be sent.
7. **Shared send path:** one core `sendToSession`, reused by the Grove CLI.

## Non-goals

- HTML artifacts, `~file` files, threaded replies, editing files, per-session
  diffs (ADR 0020), delivery acknowledgment beyond "tmux accepted the paste".

## System design

### Comment store (D2): `<userData>/comments.json`, `comments` slice

```ts
interface CommentsFile { schemaVersion: 1; comments: Comment[] }
interface Comment {
  id: string; sessionId: string   // the tray it belongs to
  anchor: CommentAnchor; body: string
  state: 'draft' | 'sent'; orphaned: boolean
  createdAt: string; updatedAt: string; sentAt: string | null // ISO
}
type CommentAnchor =
  | { kind: 'diff'; root: string; path: string; side: 'old' | 'new'
      start: number; end: number; lines: string[] }        // D3: line identity + text
  | { kind: 'artifact'; projectId: string; slug: string; path: string
      exact: string; prefix: string; suffix: string        // D3: whitespace-collapsed quote
      start: number; end: number }                         // source lines, 1-based, whole file
  | { kind: 'note' }                                       // at most one draft note per session
```

- `Slices.comments` is pushed whole as `state:comments`; `set('comments')`
  writes the file atomically. Removing a session drops its comments; at most
  100 sent comments are kept per session, oldest dropped first.

### Send path (D1): tmux bracketed paste, the same for every session kind

```
backend.paste(name, text, submit): set-buffer -b grove-send → paste-buffer -p -d -b grove-send
  -t =name:  → 150 ms → send-keys -t =name: Enter
backend.capture(name, lines): capture-pane -p -J -S -<lines> -t =name:  // readiness; CLI `read`
```

Checked 2026-10-07: Claude Code 2.1.285 and OpenCode 2.0.20 both take a
multi-line bracketed paste as one paste block. Slice 1 proves Enter submits.

`sendToSession({id, text})`: unknown → `not-found`; gone terminal → `gone`;
gone agent → `sessionResume`, then wait for the captured pane text to stay
unchanged for 1 s (from 1 s after resume, `not-ready` at 20 s); live,
`working` included → paste and submit at once.

### Anchors and re-anchoring (D3), in core

- **Diff:** on each `set('diff')` of the session, find `lines` as a contiguous
  run on the same side of the file, nearest `start`; none (or file left the
  diff) → `orphaned`, stored text kept.
- **Artifact:** on a `mtimeMs` change, search the whitespace-collapsed text of
  each markdown-it block (with `map`) for `prefix+exact+suffix`, then `exact`;
  a unique match updates `start`/`end`, else `orphaned`. Found again → not orphaned.

### Markdown selection channel (D4)

- `renderMarkdown` adds `data-line="<start>-<end>"` (`token.map`, offset by
  the frontmatter) to each block and loads `grove-artifact://assets/comments.js`.
- Iframe → app: `{grove:1, type:'select', exact, prefix, suffix, start, end}`,
  `{grove:1, type:'open', id}`. App → iframe: `{grove:1, type:'highlights',
  items:[{id, exact, prefix, suffix}]}`, `{grove:1, type:'reveal', id}`.
- The renderer accepts only `event.source === iframe.contentWindow`, a `.md`
  artifact target and a valid shape; it posts with `'*'` (opaque origin).
- Highlights use `CSS.highlights` (DOM unchanged). The editor is React UI in
  the viewer, never inside the iframe.

### Message format

```
Review comments from Grove (3). Please address each one.

<general note, if any>
## src/core/core.ts
L120-122 (new):            ← `(removed)` for old-side lines
> const x = 1
Rename x to something meaningful.
## docs/work/2026-10-07-x/03-design.md
L40-41, on "the quoted text":
Too vague. (The text has changed since this comment was written.)  ← orphaned only
```

Paths are project-relative when inside the project, else absolute. Files go
in the order of their first comment.

## Program design

### Call paths

```
Diff:      DiffViewer gutter + → CommentEditor → comment:add {sessionId, anchor:diff, body}
Markdown:  comments.js select → postMessage → ArtifactViewer editor → comment:add
           (sessionId = ui.focusedSessionId; none → Comment disabled, "Focus a session")
Send:      ReviewTray Send → review:send → core.reviewSend → formatReview → sendToSession
           → backend.paste → drafts marked sent → set('comments') → state:comments
```

### File tree

```
src/shared/types.ts, ipc.ts             MODIFIED  Comment types, Slices.comments; comment:*, review:send, state:comments
src/core/backend/types.ts, tmux.ts (+ .test)  MODIFIED  paste(), capture()
src/core/testing/fakeBackend.ts         MODIFIED  records pastes; scripted capture
src/core/comments/store.ts (+ .test)    NEW       loadComments / saveComments (v1)
src/core/comments/model.ts (+ .test)    NEW       add / update / remove / markSent, caps, note rule
src/core/comments/format.ts (+ .test)   NEW       formatReview
src/core/comments/anchor.ts (+ .test)   NEW       reanchorDiff, reanchorArtifact, blockText
src/core/send.ts (+ .test)              NEW       sendToSession: resume, readiness, paste
src/core/core.ts                        MODIFIED  comments slice, commands, re-anchor hooks, drop on remove
src/core/artifacts/markdown.ts (+ .test) MODIFIED  data-line attrs, comments.js
src/main/artifacts.ts, index.ts, ipc.ts MODIFIED  comments.js asset, comments path, channels
resources/viewer/comments.js            NEW       selection popover, highlights, postMessage
resources/viewer/markdown.css           MODIFIED  ::highlight(grove-comment), popover
src/renderer/src/stores/slices.ts       MODIFIED  comments store
src/renderer/src/reviewView.ts (+ .test) NEW      tray grouping, drafts by diff line
src/renderer/src/components/ReviewTray.tsx, CommentEditor.tsx (+ .module.css)  NEW
src/renderer/src/components/DiffViewer.tsx, ArtifactViewer.tsx  MODIFIED  gutter/range/inline; bridge/editor
src/renderer/src/App.tsx                MODIFIED  Review (n) in the session header
```

### Key signatures

```ts
paste(name: string, text: string, submit: boolean): Promise<void>        // SessionBackend
capture(name: string, lines: number): Promise<string>                    // '' when missing
commentAdd(a: { sessionId: string; anchor: CommentAnchor; body: string }): Promise<Result<Comment>>
commentUpdate(a: { id: string; body: string }): Promise<Result<Comment>>; commentDelete(a: { id: string })
reviewSend(a: { sessionId: string }): Promise<Result<{ sent: number }>>  // no drafts → 'empty'
sendToSession(a: { id: string; text: string; submit?: boolean }): Promise<Result<{ id: string }>>
formatReview(drafts: Comment[], ctx: { projectPath: string; featurePath(slug: string): string | null }): string
reanchorDiff(cs: Comment[], diff: SessionDiff): Comment[]                // same ref if unchanged
reanchorArtifact(cs: Comment[], file: { projectId: string; slug: string; path: string }, source: string): Comment[]
blockText(source: string): { start: number; end: number; text: string }[]
```

Tests: store, model, format, anchor and `send` (FakeBackend, fake clock) in
Node; `tmux.test.ts` pastes into a real `cat` pane; iframe script and UI by
hand in `npm run dev`.

## One-way decisions

**D1. Send by tmux bracketed paste plus Enter, for every kind**
([ADR 0023](../../adr/0023-send-to-session-by-tmux-paste.md)).
- Rejected: OpenCode's prompt API (experimental, a second path, TUI display
  unknown); `send-keys -l` typing (a newline submits early).

**D2. One `comments.json` in userData, pushed as a `comments` slice**
([ADR 0024](../../adr/0024-comments-in-own-state-file.md), amends ADR 0009's plan).
- Rejected: `comments/<projectId>.json` (trays are per session); inside
  `state.json` (a v4 bump; every UI change rewrites comments).

**D3. Anchors hold position plus text (diff: line identity + lines; markdown:
quote + source lines), re-anchored in core**
([ADR 0025](../../adr/0025-comment-anchors-reanchored-in-core.md), amends ADR 0008).
- Rejected: quote only (no line numbers; core can't place it); lines only
  (lost on edits above); in the iframe (orphans known only while open).

**D4. A bundled `comments.js` in markdown artifacts, over checked `postMessage`**
([ADR 0026](../../adr/0026-artifact-comment-script-and-postmessage.md), uses ADR 0007's allowance).
- Rejected: markdown in React (drops sandbox and CSP); side-panel comments
  (no highlights, clumsy for prose).

## Two-way decisions

| Decision | Choice |
|---|---|
| Tray | **Review (n)** in the session content header; a popover panel |
| Diff UI | Gutter **+**; shift-click for a range on one side of one file; ⌘↩ saves, Esc cancels |
| Drafts inline | Diff: a block under the range's last line. Markdown: highlight; a click opens the editor |
| Artifact comment's session | The focused session; none → Comment disabled. Only feature-folder `.md` |
| Orphans | Listed with their quote; sendable; marked in the message |
| Busy / gone | Send now / resume, stable pane, send; Enter 150 ms after paste; "Sending…" and errors in the tray |
| Sent history | Collapsed list; 100 per session; dropped with the session |
| Terminal sessions | Have a tray too; a send is pasted into the shell |

## Risks

- **Enter timing:** a busy TUI may take Enter as part of the paste (tunable).
- **Half-typed input** merges with a send; accepted (the human sends).
- **Quote matching:** token text can differ from rendered text (entities, task
  boxes); such drafts orphan but stay sendable.
- **Shared checkout:** a diff comment goes to the session it was written in,
  even if another session made the change (ADR 0020).
- **Artifact script** runs in every markdown artifact: bundled, CSP, no network.

## Open questions
