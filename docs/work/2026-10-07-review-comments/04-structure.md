---
feature: 2026-10-07-review-comments
phase: structure
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 03-design.md@1
forced: []
---

# Review comments — structure

## Slices

### Slice 1 — Send a general note from the tray (tracer)

- **Outcome:** the session header shows **Review**. Its tray holds one
  general note. **Send** pastes it into the session and submits it, in both
  OpenCode and Claude. The note then appears under **Sent**.
- **Files:**
  - backend `paste`/`capture` (tmux, FakeBackend)
  - `core/comments/{store,model,format}.ts`
  - `core/send.ts` (live sessions only)
  - core commands `commentAdd|Update|Delete`, `reviewSend`, `sendToSession`
  - the `comments` slice and dropping comments on session remove
  - IPC channels, the renderer store, `ReviewTray`, and the App header button
- **Signatures:** `paste`, `capture`, `sendToSession`, `reviewSend`,
  `formatReview` (note only), `loadComments`/`saveComments`.
- **Verify:**
  - `npm test`: `tmux.test.ts` "paste puts multi-line text into a pane"
    (a real `cat` pane, then capture); `comments/store.test.ts`;
    `model.test.ts`; `format.test.ts` (note); and a `core` test that
    `reviewSend` pastes once and marks the draft sent.
  - `npm run typecheck`.
  - Manual: in `npm run dev`, send a note "reply with the word pong" to an
    OpenCode session and to a Claude session. Each submits and answers.
    Restart the app: the Sent list is still there.
- **Depends on:** none.

### Slice 2 — Comment on diff lines

- **Outcome:** the diff gutter shows **+**. Clicking it, or shift-clicking for
  a range, opens the editor. A saved draft shows under its lines and in the
  tray. Sending includes `path:Lx-y (new|removed)` blocks with the quoted lines.
- **Files:** `DiffViewer.tsx` and its CSS, `CommentEditor.tsx`,
  `reviewView.ts` (drafts by line key, tray grouping), and `format.ts`
  (diff blocks, path relative to the project).
- **Signatures:** `draftsByLine(cs, path): Map<string, Comment[]>`,
  `groupForTray(cs): TrayGroup[]`.
- **Verify:**
  - `npm test`: `reviewView.test.ts`; `format.test.ts` "diff range, removed
    lines, path outside project".
  - Manual: comment on 2 lines and on a removed line, send, and check the
    agent receives all three with their line numbers.
- **Depends on:** 1.

### Slice 3 — Diff drafts re-anchor and orphan

- **Outcome:** when the diff changes, drafts follow their lines. A draft whose
  lines are gone shows as orphaned in the tray and is marked in the message.
- **Files:** `core/comments/anchor.ts` (`reanchorDiff`); `core.ts` (hook it
  after `set('diff')`); the orphan style in the tray.
- **Verify:**
  - `npm test`: `anchor.test.ts` covers "lines moved down", "two matches →
    nearest", "lines removed → orphaned" and "found again → not orphaned".
  - A core test on a temp git repo: insert lines above a draft, poke the diff,
    and check that `start` moved.
- **Depends on:** 2.

### Slice 4 — Comment on markdown artifacts

- **Outcome:** in a markdown artifact, a selection shows **Comment**. Saving
  highlights the text and adds a draft. Clicking a highlight opens the draft.
  Sending includes `path:Lx-y, on "quote"`. With no session focused, Comment
  is disabled.
- **Files:**
  - `markdown.ts` (`data-line`, the script tag)
  - `resources/viewer/comments.js` and `markdown.css`
  - `main/artifacts.ts` (the asset)
  - `ArtifactViewer.tsx` (message bridge, editor, highlights)
  - `format.ts` (artifact blocks)
- **Verify:**
  - `npm test`: `markdown.test.ts` "blocks carry data-line offset by
    frontmatter"; `format.test.ts` "artifact quote".
  - Manual: select text across two paragraphs in a `03-design.md`, comment,
    reload the app (the highlight is back), and send.
  - Manual: an HTML artifact shows no Comment popover.
- **Depends on:** 1.

### Slice 5 — Markdown drafts re-anchor and orphan

- **Outcome:** when an artifact is edited on disk, its drafts follow their
  quote to new lines. A draft whose quote is gone or ambiguous shows as
  orphaned.
- **Files:** `anchor.ts` (`blockText`, `reanchorArtifact`); `core.ts` (on
  features `mtimeMs` change, for files with drafts).
- **Verify:** `npm test`: `anchor.test.ts` covers "quote moved by an insert
  above", "quote edited → orphaned", "ambiguous → orphaned, prefix/suffix
  breaks the tie" and "frontmatter offset".
- **Depends on:** 4.

### Slice 6 — Send to working and gone sessions

- **Outcome:** **Send** on a `gone` agent session resumes it, waits for a
  stable pane, then sends. The tray shows **Sending…** while this runs, and
  shows `not-ready` and other errors inline. **Send** on a `working` session
  goes straight in.
- **Files:** `core/send.ts` (resume plus readiness); `ReviewTray.tsx`
  (pending and error state).
- **Verify:**
  - `npm test`: `send.test.ts` covers "gone → resume, waits for 1 s stable
    capture, then pastes", "never stable → not-ready at 20 s" and "gone
    terminal → gone".
  - Manual: kill a Claude session's pane with `tmux -L grove kill-session`,
    then Send. It resumes and the agent answers.
- **Depends on:** 1.

## Deferred

- Comments on HTML artifacts and on `~file` project files.
- Delivery acknowledgment, and a "message waiting" hold while the human is
  typing.
- Showing sent comments inline as history.

## Rollout / migration

- `comments.json` is new (v1), so there is nothing to migrate. A bad file is
  moved aside and reported by the existing `readVersioned` path.

## Open questions
