---
feature: 2026-10-07-review-comments
phase: implementation
status: draft
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at:
based_on:
  - 05-plan.md@1
forced: []
---

# Review comments — implementation

## Slice 1 — Send a general note from the tray (tracer)

**Changed:** `Comment`/`CommentAnchor`/`CommentsFile` and `Slices.comments`
(`shared/types.ts`); `comment:add|update|delete`, `review:send`, `state:comments`
(`shared/ipc.ts`). Backend `paste`/`capture` (tmux: `set-buffer` →
`paste-buffer -p -d` → 150 ms → `send-keys Enter`, serialised through a promise
chain; herdr stub; `FakeBackend.pastes`/`captured`). New `core/comments/{store,model,format}.ts`
and `core/send.ts` (live sessions only). Core: `commentsPath` option, the
`comments` slice (saved on `set('comments')`, loaded in `start`), commands
`commentAdd|Update|Delete`, `reviewSend`, `sendToSession`, comments dropped with
removed sessions. Renderer: `comments` in the store, `ReviewMenu` (Review (n)
button, popover with note textarea, Send, collapsed Sent list) in the session
header.

**Tests:** `tmux.test.ts` (paste into a real `cat` pane), `comments/{store,model,format,core}.test.ts`,
`send.test.ts`. `npm test` 414 pass; `npm run typecheck` clean.

**Deviations:**
- `commentAdd` returns `note-exists` for a second draft note and `empty` for a
  blank body; `commentUpdate` returns `not-draft` for a sent comment. The design
  says only "at most one draft note"; these error names are mine.
- `reviewSend` has an in-flight guard per session (`busy`), so a double click
  can't paste twice.
- `formatReview` counts all drafts, the note included, in `(n)`. It skips
  anchored drafts until slices 2 and 4; `commentAdd` already accepts any anchor.
- The tray saves the note on blur, and Send saves it first.

**Not done:** the manual check in `05-plan.md` (send "reply with the word pong"
to an OpenCode and a Claude session; restart and see Sent). It needs live agents.

## Slice 2 — Comment on diff lines

**Changed:** `format.ts` renders diff blocks under `## <path>` headings
(`L<a>-<b> (new|removed):`, quoted lines, body). Renderer: `diffView.ts`
(`sideOf`, `rangeAnchor`), new `reviewView.ts` (`draftsByLine`, `groupForTray`),
`CommentEditor` (⌘↩ saves, Esc cancels), `DiffViewer` gutter **+** (click for a
line, shift-click in the same hunk and side extends the range; editor and saved
drafts sit under the range's last line), and the tray lists drafts by file with
Edit/Delete.

**Tests:** `format.test.ts` (diff range, removed lines, path outside project),
`reviewView.test.ts`, `diffView.test.ts` (`rangeAnchor`). `npm test` 420 pass;
typecheck clean.

**Deviations:**
- A range is limited to one hunk on one side; a shift-click elsewhere starts a
  new comment instead.
- The tray's "jump to" opens the session's diff; it does not scroll to the line.
- Drafts are not highlighted on their lines beyond the block under them.

**Follow-up (human request):** selecting text over diff lines shows a floating
**Comment** button (`selectionRange` in `diffView.ts`: side of the first line,
lines of that side only, one hunk) that opens the same editor; the gutter **+**
stays. Shift+Enter (or ⌘↩) saves in `CommentEditor`. Slice 4 reuses the pattern.

**Not done:** the manual check (comment on 2 lines and a removed line, send,
agent receives all three).

## Slice 3 — Diff drafts re-anchor and orphan

**Changed:** new `core/comments/anchor.ts` (`reanchorDiff`); `core.ts` runs it after
each `set('diff')` and sets `comments` only when it returns a new array;
`format.ts` marks an orphaned diff draft ("The lines have changed since this
comment was written."); the tray shows an **orphaned** tag.

**Tests:** `anchor.test.ts` (moved down, nearest of two, gone, gap, found again,
file left the diff, old side, untouched kinds, not ok/truncated); `format.test.ts`
(orphan note); `reanchor.test.ts` (real git repo: insert lines above → `start`
moves; change the line → orphaned). `npm test` 434 pass; typecheck clean.

**Deviations:**
- The core test lives in `comments/reanchor.test.ts`, not `core.test.ts` (it
  needs a git-repo setup).
- Left alone, not orphaned: a diff that is not `ok` or is `truncated`, a file
  that is `binary` or `truncated`, and a draft whose `root` differs from the
  diff's root. Their lines can't be judged, and the design doesn't say.
- Only drafts are re-anchored; sent comments keep their anchor.
- Re-anchoring happens only while the diff is on screen (the diff is computed
  only then, design D4 of session-diff), so a closed diff's drafts update the
  next time it is opened.

**Not done:** the manual check (insert lines above a drafted line in the file,
tray shows the new line; delete the line, it shows orphaned).
