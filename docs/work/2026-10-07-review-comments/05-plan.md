---
feature: 2026-10-07-review-comments
phase: plan
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Review comments — plan

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

Ground rules: read `03-design.md` (types, message format, send path) first. Code
style: no semicolons, single quotes, 2-space indent, `Result<T>` from `@shared/ipc`.
Slice 1 creates only note drafts from the UI; the model accepts any anchor, and
`formatReview` renders only `note` drafts until slices 2 and 4.

## Slice 1 — Send a general note from the tray (tracer)

- [x] `src/shared/types.ts`: add `CommentAnchor`, `Comment`, `CommentsFile` exactly as in the design; add `comments: Comment[]` to `Slices`.
- [x] `src/shared/ipc.ts`: add `InvokeMap` channels `'comment:add'`, `'comment:update'`, `'comment:delete'`, `'review:send'` (arg/result types from the design's key signatures; delete → `{ id: string }`), and `PushMap['state:comments']: Comment[]`.
- [x] Write failing test `src/core/backend/tmux.test.ts` "paste puts multi-line text into a pane": create a session with `argv: ['cat']`, `paste(name, 'line one\nline two', true)`, poll `capture(name, 50)` until it contains both lines.
- [x] `src/core/backend/types.ts`: add `paste(name, text, submit)` and `capture(name, lines)`. `tmux.ts`: `paste` = `set-buffer -b grove-send -- <text>` → `paste-buffer -p -d -b grove-send -t =name:` → (submit) 150 ms sleep → `send-keys -t =name: Enter`, serialised through a private promise chain so two pastes never share the buffer; `capture` = `capture-pane -p -J -S -<lines> -t =name:`, `''` on any error.
- [x] `src/core/testing/fakeBackend.ts`: `pastes: { name; text; submit }[]` recorded by `paste`; `captured = new Map<string, string>()` returned by `capture` (`''` when unset).
- [x] Write failing tests `src/core/comments/store.test.ts` (missing file → empty; save then load round-trips; bad JSON moved aside and reported), `model.test.ts` (add trims and rejects empty body `'empty'`; second draft note → `'note-exists'`; update only drafts, else `'not-draft'`; remove; `markSent` sets `state`/`sentAt` and keeps the newest 100 sent per session; `dropSession`), `format.test.ts` (note: header with count, blank line, note body).
- [x] Create `src/core/comments/store.ts` (`loadComments(file, onBad)` / `saveComments(file, f)` via `readVersioned`/`atomicWrite`, v1), `model.ts` (pure: `addComment`, `updateComment`, `removeComment`, `markSent`, `dropSession`, `draftsOf`), `format.ts` (`formatReview(drafts, ctx)`: `Review comments from Grove (<n>). Please address each one.`, blank line, note body; anchored drafts skipped until slices 2/4).
- [x] Write failing test `src/core/send.test.ts`: unknown id → `not-found`; gone session → `gone`; live session → one paste with `submit: true`, `{ ok: true, data: { id } }`.
- [x] Create `src/core/send.ts`: `sendToSession(deps: { find(id): Session | undefined; backend: SessionBackend }, a: { id; text; submit? })`; backend errors become `{ ok: false, error: message }`.
- [x] `src/core/core.ts`: `CoreOptions.commentsPath`; `comments` slice (loaded in `start`, saved in `set('comments')`); `Commands` + implementations `commentAdd|commentUpdate|commentDelete|reviewSend|sendToSession`; `reviewSend` = drafts of the session (none → `'empty'`), `formatReview` (ctx: project path, `featurePath` from `slices.features.items`), `sendToSession`, `markSent`; a per-session in-flight guard (second call → `'busy'`); drop a session's comments in `dropSessions`.
- [x] `src/core/testing/setup.ts`: pass `commentsPath` (`<dir>/comments.json`) and return it. Write failing core test `src/core/comments/core.test.ts`: `reviewSend` pastes once and marks the note sent; no drafts → `'empty'`; comments survive a new core on the same files; `sessionRemove` drops them.
- [x] `src/main/ipc.ts`: handle the four channels (`returnsResult` true). `src/main/index.ts`: `commentsPath: path.join(app.getPath('userData'), 'comments.json')`.
- [x] `src/renderer/src/stores/slices.ts`: `comments` state, `api.on('state:comments')`, hydrated from `state:get`.
- [x] `src/renderer/src/components/ReviewTray.tsx` + `ReviewTray.module.css`: `ReviewMenu({ sessionId })` = a **Review (n)** ghost `Button` (n = that session's drafts) that toggles a popover (closes on Esc and outside click) holding a note textarea (saved on blur through add/update/delete), a **Send** button (flushes the note, calls `review:send`, "Sending…", inline error), and a collapsed `<details>` **Sent** list with time and body. CSS variables only.
- [x] `src/renderer/src/App.tsx`: render `<ReviewMenu sessionId={shown.session.id} />` beside the Diff button in the session header.
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [ ] Manual: `npm run dev`; send a note "reply with the word pong" to an OpenCode and a Claude session; both submit and answer; restart the app and the Sent list is still there.

## Slice 2 — Comment on diff lines

- [x] Write failing tests: `src/core/comments/format.test.ts` "diff range, removed lines, path outside project"; `src/renderer/src/reviewView.test.ts` (`draftsByLine`, `groupForTray`); `src/renderer/src/diffView.test.ts` (`rangeAnchor`).
- [x] `src/core/comments/format.ts`: diff blocks under `## <path>` headings (files in order of first comment; `L<a>-<b> (new|removed):`, `> ` quoted lines, body); path project-relative when inside the project, else absolute.
- [x] `src/renderer/src/diffView.ts`: `sideOf`, `rangeAnchor(root, file, hunk, side, a, b)` (lines of that side in one hunk between two line indices). `src/renderer/src/reviewView.ts`: `draftsByLine`, `groupForTray`.
- [x] `src/renderer/src/components/CommentEditor.tsx` + `.module.css`: textarea with Save/Cancel; ⌘↩ saves, Esc cancels.
- [x] `DiffViewer.tsx` + CSS: gutter **+** on each line; click opens the editor under the line; shift-click in the same hunk and side extends the range; saving calls `comment:add` with `anchor` from `rangeAnchor`; drafts render under their last line with Edit/Delete.
- [x] `ReviewTray.tsx`: list drafts by file (`groupForTray`) with quote, edit and delete; clicking a quote opens the session's diff.
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [ ] Manual: comment on 2 lines and on a removed line, send, and check the agent receives all three with their line numbers.
