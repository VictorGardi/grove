# Reads never run repo code; create and remove keep hooks

Spaces and worktrees ask git two kinds of questions. The 3 s refresh and listing only read: they run with a short limit (10 s), English output, and none of a repo's hooks, pager or file-watch commands, because a cloned repo's config must not run code in the background. Creating and removing a worktree space are writes: they keep the repo's own hooks (a post-checkout install is expected), get a long limit (about 2 min) and still run without a file-watch command or prompts. All git output is English.

If a create times out, Grove removes the half-made checkout and the branch that create made, never a branch or folder that already existed; a checkout that is complete (only a hook was slow) is kept. A remove that times out is left as git left it and never offers "Force remove?".

Consequences: a non-English user sees English git errors in the create and remove dialogs. A hook that depends on the user's language runs in English too.
