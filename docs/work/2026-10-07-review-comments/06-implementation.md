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

## Slice 4 — Comment on markdown artifacts

**Changed:** `markdown.ts` adds `data-line="<start>-<end>"` (whole-file lines, offset by the frontmatter) to block tokens and loads `comments.js` (`defer`). New `resources/viewer/comments.js` (selection → Comment popover → `select`; `CSS.highlights` for drafts; click a highlight → `open`; `reveal`), `markdown.css` styles, `main/artifacts.ts` asset. `format.ts` renders artifact blocks (`L<a>-<b>, on "quote":`, quote cut at 200 chars, orphan note) under the same `## path` headings as diff blocks. Renderer: `artifactComments.ts` (`parseIframeMessage`, `isCommentable`, `artifactAnchor`, `draftsForFile`), `ArtifactViewer` bridge and editor panel under the frame, tray lists artifact drafts (label `slug/path`, quote, Jump opens the artifact).

**Tests:** `markdown.test.ts` (data-line with frontmatter offset, script tag), `format.test.ts` "artifact quote", `artifactComments.test.ts`. `npm test` 441 pass; typecheck clean. Existing markdown tests loosened for the new attributes.

**Deviations:**
- Two messages beyond the design: iframe → app `ready`, app → iframe `config {canComment}` (Comment is disabled with no focused session). The app also sends `highlights` on `ready` and whenever drafts or the focused session change.
- The iframe computes the quote from its own whitespace-collapsed rendered text with a space between blocks; `start`/`end` are the source lines of the nearest `data-line` blocks at each end of the selection (coarse; slice 5 refines).
- The editor panel sits below the frame, with a Delete button when editing an existing draft.
- Selection in the frame ignores selections that start or end outside a `data-line` block (e.g. the frontmatter table).

**Not done:** the manual checks (iframe script has no automated test; needs `npm run dev`).

## Slice 5 — Markdown drafts re-anchor and orphan

**Changed:** `anchor.ts` gains `blockText` (rendered text per leaf block, whole-file lines) and `reanchorArtifact`; `markdown.ts` exports `parseMarkdown` (shared with `renderMarkdown`). Core: after each `publish()` it re-anchors drafts of any feature artifact whose `mtimeMs` differs from the last one seen (or unseen) and that has an artifact draft.

**Tests:** `anchor.test.ts` (blockText; moved by insert, edited, ambiguous with and without prefix/suffix, frontmatter, two blocks, found again, untouched kinds), `reanchor.test.ts` "core artifact drafts" (edit on disk → lines follow, then orphaned). `npm test` 451 pass; typecheck clean.

**Deviations:**
- Matching tries four tiers (`prefix+exact+suffix`, `prefix+exact`, `exact+suffix`, `exact`) and stops at the first tier with any hit; one hit places it, several orphan it. The design said "prefix+exact+suffix, then exact"; the two middle tiers were added so a frontmatter-table prefix at the document start doesn't defeat the tie-break.
- Blocks are joined with a space, so a quote that spans blocks places `start` at the first block and `end` at the last.
- An unreadable file (deleted) is left alone, not orphaned.

**Not done:** the manual check (insert a paragraph above a commented quote on disk; tray lines follow; edit the quote; orphaned).

## Slice 6 — Send to working and gone sessions

**Changed:** `send.ts`: a gone agent session (with an `agentSessionId`) is resumed through `deps.resume`, then after 1 s the pane is polled every 250 ms until its non-empty text has held for 1 s (`not-ready` at 20 s); a gone terminal stays `gone`; live and `working` sessions paste at once. Deps `sleep`/`now` allow a fake clock. Core wires `resume` to `sessionResume`. The tray maps `not-ready`, `gone`, `busy`, `empty` to readable messages and shows **Resuming…** while a gone session is resumed (else **Sending…**).

**Tests:** `send.test.ts` (resume then 1 s stable then paste, never stable → `not-ready`, empty pane, resume failure, gone terminal), `comments/core.test.ts` (gone Claude session resumed and sent). `npm test` 457 pass; typecheck and `npm run build` clean.

**Deviations:**
- A gone agent session without an `agentSessionId` returns `gone`, like a terminal.
- The core test waits about 1 s of real time (no clock injection into core).

**Not done:** the manual check (kill a Claude pane with `tmux -L grove kill-session`, Send, agent answers).

## PR description

**Review comments.** Add several comments to a session's diff and to markdown artifacts, then send them to that session as one message.

- **Design:** one `comments.json` (ADR 0024); sends are a tmux bracketed paste plus Enter for every session kind (ADR 0023); anchors hold position plus text and are re-anchored in core (ADR 0025); markdown artifacts load a bundled `comments.js` that talks over checked `postMessage` (ADR 0026).
- **Slices:** 1 general note and Send from the **Review (n)** tray; 2 comments on diff lines (gutter **+**, shift range, selection); 3 diff drafts re-anchor and orphan; 4 comments on markdown artifacts; 5 markdown drafts re-anchor and orphan; 6 Send resumes a gone agent session and waits for a stable pane.
- **Verify:** `npm test`, `npm run typecheck`, `npm run build`. By hand in `npm run dev`: send a note to an OpenCode and a Claude session; comment on diff lines and on a removed line; insert lines above a comment and see it follow, delete the line and see it orphaned; select text in a `03-design.md`, comment, reload, send; kill a Claude pane and Send.
