import path from 'node:path'
import type { Session } from '@shared/types'
import type { AgentKind } from '../agents/types'

// Every host path a sandboxed session's container binds, each at the identical path inside
// (ADR 0035): diff, discovery, autolink and the viewer all resolve `project.path` on the host,
// so a remapped path would break all four. Resolved once, in `src/main/index.ts`.
export interface AgentPaths {
  claudeHome: string
  claudeJson: string
  opencodeShare: string
  opencodeConfig: string
  opencodeState: string
  opencodeServiceConfig: string
  gitconfig: string
  spoolDir: string
  socketPath: string
  cliBundle: string
}

// What grove actually mounts with: everything optional but the socket, since a pane that cannot
// reach the app has no CLI at all. A path main did not resolve is simply left unmounted —
// `container` tolerates an absent `--read-only-path` target, and a `--volume` of a path that is
// not there would create it.
export type MountPaths = Partial<AgentPaths> & { socketPath: string }

// What `core.hooksPath` points at inside the image: an empty directory baked into it. Set at
// git's command-line scope it beats both `~/.gitconfig` and `.git/config` for every git call in
// the pane, so a host hook can never run as uid=0 inside. A repo that uses `core.hooksPath` of
// its own loses those hooks — the same class of divergence as shipping no rc files.
const NO_HOOKS = '/etc/grove/no-hooks'

export interface SandboxSpec {
  container: string // the `container` binary
  image: string // grove-sandbox:<sha256 of the Dockerfile>
  cwd: string // the session's working directory, host-identical
  mounts: string[] // `<host>:<host>`, read-write
  readOnlyPaths: string[]
  env: Record<string, string>
  cliBundle?: string // where the CLI bundle is mounted (D7); absent: no `grove` in the sandbox
}

// The whole host the sandbox sees, as read-write binds. `commonDir` arrives already resolved:
// non-null only when it needs a volume of its own (D2).
export function mountsFor(kind: AgentKind, o: { cwd: string; commonDir: string | null; paths: MountPaths }): string[] {
  const p = o.paths
  const bind = (host: string | undefined) => (host ? [`${host}:${host}`] : [])
  return [
    `${o.cwd}:${o.cwd}`,
    ...(o.commonDir ? [`${o.commonDir}:${o.commonDir}`] : []),
    ...(kind === 'claude'
      ? [...bind(p.claudeHome), ...bind(p.claudeJson)]
      : [...bind(p.opencodeShare), ...bind(p.opencodeConfig)]),
    ...bind(p.spoolDir), // hooks append to it from inside, so it cannot be read-only
    ...bind(p.socketPath),
    ...bind(p.cliBundle),
  ]
}

// Everything carved out of the read-write binds. Read-only is the default for everything the
// agent must not change: an agent that could write the gitconfig could set `core.hooksPath` for
// every unsandboxed git run on this host afterwards, and one that could write a worktree's hooks
// or config could make the host run something on its next checkout.
export function readOnlyPathsFor(kind: AgentKind, o: { commonDir: string | null; paths: MountPaths }): string[] {
  const p = o.paths
  return [
    ...(o.commonDir ? [path.join(o.commonDir, 'hooks'), path.join(o.commonDir, 'config')] : []),
    ...(p.gitconfig ? [p.gitconfig] : []),
    ...(kind === 'opencode' && p.opencodeState ? [p.opencodeState] : []), // D6: never evict the host's service
    ...(p.cliBundle ? [p.cliBundle] : []),
  ]
}

// The pane's env *inside* the VM. The host login shell still runs outside it (ADR 0010), so
// this is the agent's whole environment: the image's, plus these.
export function envFor(session: Session, o: { socketPath: string }): Record<string, string> {
  return {
    GROVE_SESSION_ID: session.id,
    GROVE_SOCKET: o.socketPath,
    TERM: 'xterm-256color', // not the pane's own TERM: the image knows nothing of tmux's
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: NO_HOOKS,
  }
}

export function specFor(o: {
  kind: AgentKind
  cwd: string
  commonDir: string | null // `gitCommonDir(cwd)`, or null: not a repo
  paths: MountPaths
  session: Session
  container: string
  image: string
}): SandboxSpec {
  // A plain checkout's common dir is `.git`, *below* the working directory, so the working
  // directory's volume already carries it and it needs no carve-outs. A worktree's points at
  // another repository entirely, and a session started in a subfolder's points at its parent —
  // both outside the mount, without which git cannot resolve them at all (D2).
  const commonDir = o.commonDir && !o.commonDir.startsWith(o.cwd + path.sep) ? o.commonDir : null
  return {
    container: o.container,
    image: o.image,
    cwd: o.cwd,
    mounts: mountsFor(o.kind, { cwd: o.cwd, commonDir, paths: o.paths }),
    readOnlyPaths: readOnlyPathsFor(o.kind, { commonDir, paths: o.paths }),
    env: envFor(o.session, { socketPath: o.paths.socketPath }),
    ...(o.paths.cliBundle && { cliBundle: o.paths.cliBundle }),
  }
}