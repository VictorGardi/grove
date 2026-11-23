# A pin is saved with its space, in Grove's own state

A pin marks a space the human wants to come back to. It is saved on the space itself in Grove's own saved state, with the time it was pinned, not in the window's own settings. The pin therefore ends when its space is closed, with no clean-up, and every client (the window, the CLI, any later window) sees the same pins and the same order. A space closed and added again is a new space and is not pinned.

Considered and rejected:

- The window's own settings (like the heading folds). They are per window, so pins would differ between windows and be lost if the window's storage is cleared. A pin would also outlive its space and need pruning.
- A separate list of pinned spaces. The list could disagree with the spaces, and removing a space would have to remember to edit it.

Consequences: pinning is a write to the saved state, so it fails while that state file is refused, and the window must say so. The Pinned group lists spaces by pin time, so the time is kept, not a bare flag. A pinned worktree whose folder is deleted outside Grove stays pinned until its space is closed in Grove.
