// The text pasted into an agent for "Send": the pending review comments as markdown. The same for every agent kind.
import type { DiffComment } from '../protocol/messages.ts'
import { commentEnd } from './diff-model.ts'

export const REVIEW_INTRO = 'Review comments on the current changes:'
export const OUTDATED_NOTE = '(outdated: the code has changed since)'

// A fence one backtick longer than any run of them in the snippet, and at least three.
function fenceFor(snippet: string): string {
  const longest = Math.max(0, ...(snippet.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

function itemText(comment: DiffComment, outdated: boolean): string {
  const end = commentEnd(comment)
  const where = `${comment.path}:${comment.line}${end === comment.line ? '' : `-${end}`} (${comment.side})${outdated ? ` ${OUTDATED_NOTE}` : ''}`
  const snippet = [...comment.before, ...comment.anchor.split('\n'), ...comment.after].join('\n')
  const fence = fenceFor(snippet)
  return `${where}\n${fence}\n${snippet}\n${fence}\n${comment.body}`
}

// The pending comments, by file and then line; resolved and sent ones are left out. `outdated` says which comments no longer fit their line.
export function reviewMessage(comments: readonly DiffComment[], outdated: (comment: DiffComment) => boolean): string {
  const pending = comments
    .filter((comment) => comment.state === 'pending')
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || a.line - b.line || (a.side === b.side ? 0 : a.side === 'old' ? -1 : 1))
  return `${REVIEW_INTRO}\n\n${pending.map((comment) => itemText(comment, outdated(comment))).join('\n\n')}`
}
