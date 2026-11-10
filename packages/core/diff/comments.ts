// The review comments of a folder's diff: what the core accepts from a call and what it trusts from the state file.
import crypto from 'node:crypto'
import { DIFF_COMMENT_LIMITS, ERROR_CODES, type DiffComment } from '../../protocol/messages.ts'
import { RpcError } from '../../protocol/errors.ts'

type NewComment = Pick<DiffComment, 'path' | 'side' | 'line' | 'endLine' | 'anchor' | 'before' | 'after' | 'body'>
export interface CommentChange {
  id: string
  body?: string
  state?: 'pending' | 'resolved'
}

const bad = (message: string): RpcError => new RpcError(ERROR_CODES.invalidParams, message)

function bodyParam(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw bad('comment body must not be empty')
  if (value.length > DIFF_COMMENT_LIMITS.body) throw bad(`comment body must be ${DIFF_COMMENT_LIMITS.body} characters or fewer`)
  return value
}

// A line of code, cut to the cap: the comment keeps the start of a very long line.
function lineParam(value: unknown, name: string): string {
  if (typeof value !== 'string') throw bad(`${name} must be a string`)
  return value.slice(0, DIFF_COMMENT_LIMITS.line)
}

// The text of the commented lines, one per line of the range, each cut to the cap.
function anchorParam(value: unknown, lines: number): string {
  if (typeof value !== 'string') throw bad('anchor must be a string')
  const parts = value.split('\n')
  if (parts.length !== lines) throw bad(`anchor must have the text of the ${lines} commented ${lines === 1 ? 'line' : 'lines'}`)
  return parts.map((part) => part.slice(0, DIFF_COMMENT_LIMITS.line)).join('\n')
}

function contextParam(value: unknown, name: string, keep: 'last' | 'first'): string[] {
  if (!Array.isArray(value)) throw bad(`${name} must be a list of lines`)
  const lines = value.map((line) => lineParam(line, name))
  return keep === 'last' ? lines.slice(-DIFF_COMMENT_LIMITS.context) : lines.slice(0, DIFF_COMMENT_LIMITS.context)
}

export function newCommentParams(p: Record<string, unknown>): NewComment {
  if (typeof p.path !== 'string' || p.path === '' || p.path.length > DIFF_COMMENT_LIMITS.path || p.path.includes('\0')) throw bad('path is not a valid file path')
  if (p.side !== 'old' && p.side !== 'new') throw bad('side must be old or new')
  if (typeof p.line !== 'number' || !Number.isSafeInteger(p.line) || p.line < 1) throw bad('line must be a positive whole number')
  const end = p.endLine
  if (end !== undefined && (typeof end !== 'number' || !Number.isSafeInteger(end) || end <= p.line || end - p.line >= DIFF_COMMENT_LIMITS.range)) {
    throw bad(`endLine must be a whole number after line, within ${DIFF_COMMENT_LIMITS.range} lines of it`)
  }
  return {
    path: p.path,
    side: p.side,
    line: p.line,
    ...(end === undefined ? {} : { endLine: end }),
    anchor: anchorParam(p.anchor, end === undefined ? 1 : end - p.line + 1),
    before: contextParam(p.before, 'before', 'last'),
    after: contextParam(p.after, 'after', 'first'),
    body: bodyParam(p.body),
  }
}

export function commentChangeParams(p: Record<string, unknown>): CommentChange {
  if (typeof p.id !== 'string' || p.id === '') throw bad('comment id is not valid')
  if (p.state === 'sent') throw bad('a comment becomes sent only by sending it to an agent')
  if (p.state !== undefined && p.state !== 'pending' && p.state !== 'resolved') throw bad('state must be pending or resolved')
  if (p.body === undefined && p.state === undefined) throw bad('nothing to change: give a body or a state')
  return { id: p.id, body: p.body === undefined ? undefined : bodyParam(p.body), state: p.state }
}

export function commentIdParam(p: Record<string, unknown>): string {
  if (typeof p.id !== 'string' || p.id === '') throw bad('comment id is not valid')
  return p.id
}

export function commentIdsParam(p: Record<string, unknown>): string[] {
  if (!Array.isArray(p.ids) || p.ids.length > DIFF_COMMENT_LIMITS.perFolder || !p.ids.every((id) => typeof id === 'string' && id !== '')) throw bad('ids must be a list of comment ids')
  return p.ids
}

export function makeComment(input: NewComment, now: number): DiffComment {
  return { id: crypto.randomUUID(), ...input, state: 'pending', createdAt: now }
}

const isLines = (value: unknown): value is string[] => Array.isArray(value) && value.every((line) => typeof line === 'string')

// The comments of a folder as the state file has them. An entry that does not read right is left out, as diffPrefs falls back for one.
export function readComments(value: unknown): DiffComment[] {
  if (!Array.isArray(value)) return []
  return value.filter((c): c is DiffComment => {
    if (typeof c !== 'object' || c === null) return false
    const e = c as Record<string, unknown>
    return (
      typeof e.id === 'string' &&
      typeof e.path === 'string' &&
      (e.side === 'old' || e.side === 'new') &&
      typeof e.line === 'number' &&
      (e.endLine === undefined || typeof e.endLine === 'number') &&
      typeof e.anchor === 'string' &&
      isLines(e.before) &&
      isLines(e.after) &&
      typeof e.body === 'string' &&
      (e.state === 'pending' || e.state === 'sent' || e.state === 'resolved') &&
      typeof e.createdAt === 'number'
    )
  })
}
