---
feature: 2026-10-07-unify-viewer-targets
phase: questions
status: approved
approved_at: 2026-10-07
version: 1
created: 2026-10-07
updated: 2026-10-07
based_on:
  - 00-ticket.md
forced:
  - "2026-10-07: size verdict is M but small flow requires S; human chose small flow explicitly"
---

# Unify viewer targets and comment anchors

## Goal

Any markdown file the viewer renders can be commented on in the same way, with
no distinction between feature-folder files and other project files, and the
code has one kind of viewer target and one kind of markdown comment anchor.

## Out of scope

- Comments on HTML artifacts (sandboxed iframe, ADR 0007).
- Editing files in the app.
- Changes to diff comments (`kind: 'diff'`) and the session note.
- New viewer features (navigation, search) beyond opening and commenting.

## Research questions

1. Which viewer target shapes exist today, where is each created, stored
   (including in persisted state and its versioned migrations), compared, and
   consumed, and which fields does each carry?
2. How is a `grove-artifact://` URL built and parsed, how does the protocol
   handler resolve each route to a file on disk, and what checks does each
   route apply?
3. What is stored in a markdown comment anchor today, where are comments
   persisted and migrated, and which code reads the anchor's `slug` and `path`
   (re-anchoring, message formatting, the tray, the viewer)?
4. How does the rendered markdown frame decide whether text selection offers
   Comment, and what does the app do with the frame's messages?
5. Where do feature folders live relative to their project's folder and to
   session worktrees: how are folders discovered, what does a feature's `path`
   hold, and can it ever be outside the registered project path?
6. How does the session diff decide which changed files open rendered, what
   does `rendered` carry, and how does a rendered file open from the diff?
7. How are links between documents handled in the rendered viewer (relative
   links, images, links to other feature files or project files)?
8. What tests cover viewer targets, the URL scheme, comment anchors,
   re-anchoring, formatting and state migration, and which ADRs describe these
   areas?

## Product questions for the human

1. Drafts already saved with a slug-based anchor: migrate or drop?
   **Answer (human, 2026-10-07): drop.** Unsent drafts with the old anchor are
   discarded on upgrade; sent comments are unaffected.

## Verification notes for implementation

Research questions 1-8 are not run in `small` flow: `grove-implement` must
verify them against the code, in particular question 5 (can a feature folder
be outside the project folder, e.g. in a worktree? If so the target needs a
root as well as a path).

## Size verdict

**M.** Roughly 20 files, mostly mechanical, with a few one-way decisions
(URL scheme, persisted anchor and viewer shapes, state migration). Known
pattern and well covered by tests. Proposed `standard`; the human chose `small` (see `feature.md` flow log).

## Open questions
