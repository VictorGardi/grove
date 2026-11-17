# The sidebar groups a repo's spaces under a heading that is not a space

A repo is drawn as a **heading** with its spaces as rows: the main checkout is one row, each worktree space another. The heading has no tabs and is not a space, so clicking it only folds or unfolds. A repo with a single checkout has a heading too, so every repo reads the same; only a space outside git is a plain row. A worktree whose main checkout is not a space still sits under a heading named after the repo, and the main checkout's row appears in place when it is added.

The heading is keyed by the repo, not by the main checkout's space, because the human's fold choice is saved per repo and has to survive the main checkout being added or removed. The fold defaults to open. The active space's heading stays open while it is active, without overwriting the saved choice. A folded heading shows the most urgent state among its rows.

Considered and rejected:

- Keeping the main checkout as the parent row. A folded parent would hide the checkout you work in, and the trunk would carry a state of its own.
- A plain row for a worktree with no main checkout. Several worktrees of one repo would scatter, and none could fold.

Consequences: the code's parent links stay as they are and drive only grouping. The saved fold choices are a new stored preference that must drop repos that no longer exist. Per-agent rows and letter tiles go away, so Resume moves to the exited tab's pane.
