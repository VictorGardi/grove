import type { SessionKind } from '@shared/types'

// Which session kinds can be sandboxed at all, and whether one is being asked to. One place for
// both, because they answer different questions and nothing else keeps them equal: the dialog asks
// the first to decide whether to offer the toggle, and `startLaunch` asks the second to decide what
// is sent. When OpenCode becomes eligible in slice 6 it moves here once, not in two files.

// Only Claude: a terminal has no agent argv to wrap, and a sandboxed OpenCode would register its
// own service and evict the host's (ADR 0034, D6).
export const sandboxable = (kind: SessionKind): boolean => kind === 'claude'

// Whether this launch actually asks for a sandbox. False for an unsandboxable kind however the
// toggle is left, so the flag can never reach core set on a kind that would be refused `no-sandbox`:
// the form may carry `true` over from a previous kind, and the human would not see why a session
// they asked to be sandboxed was not.
export const wantsSandbox = (kind: SessionKind, sandboxed: boolean): boolean => sandboxable(kind) && sandboxed

// Off, because the human has not asked for containment. 03-design.md: "Default off";
// 01-questions.md: "not a default for every session", "explicit per-session decision"; ADR 0033
// rejects "making sandboxing the default" outright.
export const SANDBOX_DEFAULT = false
