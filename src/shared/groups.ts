// How the session list names a group in `ui.collapsed`: one prefix per level — `p:` for a
// project's own group, `w:` for a worktree's group under it. Worktree rows start collapsed,
// so what the human's own choice is remembered is the opposite: the key they *opened*, `o:`
// plus the worktree key. (ADR 0037.)
export const projectKey = (id: string) => 'p:' + id
export const worktreeKey = (id: string) => 'w:' + id
export const openedKey = (key: string) => 'o:' + key

// Every `ui.collapsed` key that can name one project. Removing a project has to drop these,
// or the list keeps a key for a checkout that is no longer there, forever.
export const projectKeys = (id: string) => [projectKey(id), worktreeKey(id), openedKey(worktreeKey(id))]

// The project a group key names; '' when it names none — a workflow-status group ('s:done')
// or the ungrouped list ('all'), which are not a project's to forget.
export const keyProjectId = (key: string) => /^(?:o:)?[pw]:(.+)$/.exec(key)?.[1] ?? ''